import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Task, ProcurementPo, ProcurementFabItem } from "@/lib/types";
import { computeStatus, summarize, overallProgress, STATUS_LABEL } from "@/lib/schedule";

interface ExportOptions {
  projectName: string;
  projectCode?: string | null;
  customer?: string | null;
  pos?: ProcurementPo[];
  fabItems?: ProcurementFabItem[];
}

/**
 * Builds a one-page-per-section PDF status report: summary numbers, then
 * the full task list grouped by department. Used by both the Task Table
 * and Gantt pages ("Export PDF") since they share the same underlying
 * task data -- this is the tabular equivalent of what's on screen, not a
 * pixel copy of the Gantt bars themselves.
 */
export function exportTasksPdf(tasks: Task[], opts: ExportOptions) {
  const today = new Date();
  const summary = summarize(tasks, today);
  const progress = overallProgress(tasks);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFontSize(16);
  doc.text(opts.projectName, margin, 44);
  doc.setFontSize(10);
  doc.setTextColor(110);
  const subtitleParts = [opts.customer, opts.projectCode].filter(Boolean);
  if (subtitleParts.length) {
    doc.text(subtitleParts.join(" · "), margin, 60);
  }
  doc.text(`Generated ${today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, pageWidth - margin, 44, {
    align: "right",
  });
  doc.setTextColor(0);

  const summaryRows = [
    ["Overall progress", `${progress.weightedPercent}%`],
    ["Total tasks", String(summary.totalTasks)],
    ["Completed", String(summary.completed)],
    ["On track", String(summary.onTrack)],
    ["At risk", String(summary.atRisk)],
    ["Delayed", String(summary.delayed)],
  ];

  autoTable(doc, {
    startY: 76,
    margin: { left: margin, right: margin },
    head: [summaryRows.map((r) => r[0])],
    body: [summaryRows.map((r) => r[1])],
    theme: "plain",
    styles: { fontSize: 9, halign: "center", cellPadding: 4 },
    headStyles: { fontStyle: "bold", textColor: 90 },
    tableWidth: pageWidth - margin * 2,
  });

  const leafTasks = tasks
    .filter((t) => !t.is_summary && t.is_active)
    .sort((a, b) => a.id - b.id);

  const body = leafTasks.map((t) => [
    t.task_no,
    t.description,
    t.department,
    t.assignee || "—",
    `${t.scheduled_start.slice(5)} → ${t.scheduled_finish.slice(5)}`,
    `${t.percent_complete}%`,
    STATUS_LABEL[computeStatus(t, today)],
  ]);

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24,
    margin: { left: margin, right: margin },
    head: [["#", "Task", "Dept", "Owner", "Schedule", "% Done", "Status"]],
    body,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [55, 53, 47], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: "auto" },
      5: { cellWidth: 45, halign: "center" },
      6: { cellWidth: 70 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 6) {
        const status = leafTasks[data.row.index] && computeStatus(leafTasks[data.row.index], today);
        const colors: Record<string, [number, number, number]> = {
          delayed: [161, 61, 47],
          at_risk: [183, 121, 31],
          on_track: [47, 111, 79],
          completed: [58, 90, 140],
          not_started: [120, 120, 120],
        };
        if (status && colors[status]) {
          data.cell.styles.textColor = colors[status];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  // Procurement summary page (only added when data exists)
  if ((opts.pos?.length ?? 0) > 0 || (opts.fabItems?.length ?? 0) > 0) {
    doc.addPage();
    doc.setFontSize(13);
    doc.setTextColor(0);
    doc.text("Procurement Summary", margin, 44);
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(opts.projectName, margin, 58);
    doc.setTextColor(0);

    let yPos = 72;

    if ((opts.pos?.length ?? 0) > 0) {
      doc.setFontSize(10);
      doc.setTextColor(60);
      doc.text("Purchase Orders", margin, yPos);
      yPos += 4;

      const poBody = (opts.pos ?? []).map(po => [
        po.po_number || "—",
        po.item_description,
        po.supplier_name,
        po.status.charAt(0).toUpperCase() + po.status.slice(1),
        po.expected_delivery ? new Date(po.expected_delivery).toLocaleDateString("en-MY") : "—",
        po.total_price != null ? `${po.currency} ${Number(po.total_price).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "—",
      ]);

      autoTable(doc, {
        startY: yPos,
        margin: { left: margin, right: margin },
        head: [["PO No.", "Item", "Supplier", "Status", "Expected Delivery", "Amount"]],
        body: poBody,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [55, 53, 47], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 55 },
          1: { cellWidth: "auto" },
          3: { cellWidth: 55, halign: "center" },
          4: { cellWidth: 75, halign: "center" },
          5: { cellWidth: 80, halign: "right" },
        },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 3) {
            const status = poBody[data.row.index]?.[3]?.toLowerCase();
            const colors: Record<string, [number, number, number]> = {
              issued: [47, 90, 140], partial: [140, 100, 20],
              received: [47, 111, 79], cancelled: [140, 50, 40],
            };
            if (status && colors[status]) {
              data.cell.styles.textColor = colors[status];
              data.cell.styles.fontStyle = "bold";
            }
          }
        },
      });

      yPos = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
    }

    if ((opts.fabItems?.length ?? 0) > 0) {
      doc.setFontSize(10);
      doc.setTextColor(60);
      doc.text("Fabrication Items", margin, yPos);
      yPos += 4;

      const fabStatusLabel: Record<string, string> = {
        not_started: "Not Started", in_fabrication: "In Fab",
        qc: "QC", ready: "Ready", delivered: "Delivered", cancelled: "Cancelled",
      };

      const fabBody = (opts.fabItems ?? []).map(f => [
        f.item_name,
        f.drawing_ref || "—",
        f.fab_vendor || "—",
        fabStatusLabel[f.status] || f.status,
        f.expected_completion ? new Date(f.expected_completion).toLocaleDateString("en-MY") : "—",
        f.cost != null ? `${f.currency} ${Number(f.cost).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "—",
      ]);

      autoTable(doc, {
        startY: yPos,
        margin: { left: margin, right: margin },
        head: [["Item", "Drawing Ref", "Fabricator", "Status", "Due Date", "Cost"]],
        body: fabBody,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [55, 53, 47], textColor: 255 },
        columnStyles: {
          0: { cellWidth: "auto" },
          3: { cellWidth: 55, halign: "center" },
          4: { cellWidth: 65, halign: "center" },
          5: { cellWidth: 80, halign: "right" },
        },
      });
    }
  }

  const filenameSafe = opts.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`${filenameSafe || "project"}-status-${today.toISOString().slice(0, 10)}.pdf`);
}
