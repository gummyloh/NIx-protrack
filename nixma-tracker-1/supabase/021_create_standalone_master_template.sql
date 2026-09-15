-- Splits the clone-from-template source out of Liquick's live project into
-- a standalone project that exists purely to be cloned. Liquick's project
-- row had been doing double duty as both the active Teleflex project AND
-- the hardcoded template every new project copied from -- which had
-- already caused a real bug: H090 (unrelated Modine hardware) inherited 17
-- pouch-machine-specific tasks (ids 75-91 on Liquick) that only made sense
-- for Liquick's own build. The original 74-task structure (Liquick's ids
-- 1-74) is the genuinely generic skeleton, so that's what's captured here
-- verbatim -- same ids, dates, and dependency chain as they existed live
-- at the time of this split, just under a new project_id.
alter table nixma.projects add column if not exists is_template boolean not null default false;

insert into nixma.projects (id, name, customer, project_code, kickoff_date, target_end_date, customer_password, is_template)
values (
  'master-template',
  'Master Template -- Standard Automation Build',
  'Template only -- not a real customer',
  null,
  date '2026-07-27',
  date '2027-01-09',
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
  true
)
on conflict (id) do nothing;

insert into nixma.tasks (
  id, project_id, phase, task_no, description, duration_days,
  planned_start, planned_finish, indent_level, parent_id,
  department, is_summary, is_active, predecessor_id, lag_days,
  scheduled_start, scheduled_finish, percent_complete, show_to_client
)
select v.id, 'master-template', v.phase, v.task_no, v.description, v.duration_days,
       v.planned_start, v.planned_finish, v.indent_level, v.parent_id,
       v.department, v.is_summary, v.is_active, v.predecessor_id, v.lag_days,
       v.planned_start, v.planned_finish, 0, true
from (values
  (183,1,1,'Internal Kick-Off',1,date '2026-07-27',date '2026-07-27',0,null::bigint,'Project Management',true,true,null::bigint,0),
  (184,1,2,'Project Kick-Off Preparation',1,date '2026-07-27',date '2026-07-27',1,183,'Project Management',false,true,null,0),
  (185,1,3,'Project Kick-Off',1,date '2026-07-27',date '2026-07-27',1,183,'Project Management',false,true,null,0),
  (186,1,4,'Mechanical Concept Design Sign-Off',23,date '2026-07-28',date '2026-08-19',0,null,'Mechanical',true,true,null,0),
  (187,1,5,'PR Standard Part List A (long lead time parts)',1,date '2026-07-28',date '2026-07-28',1,186,'Mechanical',false,true,184,0),
  (188,1,6,'Timing Diagram/Process Flowchart',3,date '2026-07-29',date '2026-07-31',1,186,'Mechanical',false,true,187,0),
  (189,1,7,'Machine Layout',15,date '2026-08-01',date '2026-08-15',1,186,'Mechanical',false,true,188,0),
  (190,1,8,'Conceptual Design/First Drawings',2,date '2026-08-16',date '2026-08-17',1,186,'Mechanical',false,true,189,0),
  (191,1,9,'Conceptual Design Sign-Off (Internal)',2,date '2026-08-18',date '2026-08-19',1,186,'Mechanical',false,true,190,0),
  (192,1,10,'Electrical/SW Concept Design Sign-Off',23,date '2026-07-28',date '2026-08-19',0,null,'Electrical',true,true,null,0),
  (193,1,11,'PR Standard Part List A (long lead time parts)',1,date '2026-07-28',date '2026-07-28',1,192,'Electrical',false,true,184,0),
  (194,1,12,'Sequence Flowchart/Control Panel Layout',3,date '2026-07-29',date '2026-07-31',1,192,'Electrical',false,true,193,0),
  (195,1,13,'Components Sourcing & Testing',15,date '2026-08-01',date '2026-08-15',1,192,'Electrical',false,true,194,0),
  (196,1,14,'Conceptual Design ( Draft IO List & Electrical Circuit)',2,date '2026-08-16',date '2026-08-17',1,192,'Electrical',false,true,195,0),
  (197,1,15,'Conceptual Design Sign-Off (Internal)',2,date '2026-08-18',date '2026-08-19',1,192,'Electrical',false,true,196,0),
  (198,1,16,'Mechanical Engineering',35,date '2026-08-20',date '2026-09-23',0,null,'Mechanical',true,true,null,0),
  (199,1,17,'Control Panel Design',1,date '2026-08-20',date '2026-08-20',1,198,'Mechanical',false,true,191,0),
  (200,1,18,'Machine Structure Design',2,date '2026-08-21',date '2026-08-22',1,198,'Mechanical',false,true,199,0),
  (201,1,19,'Module Design',18,date '2026-08-23',date '2026-09-09',1,198,'Mechanical',false,true,200,0),
  (202,1,20,'Part Drawing',7,date '2026-09-10',date '2026-09-16',1,198,'Mechanical',false,true,201,0),
  (203,1,21,'Pneumatic/Hydraulic Schematic',1,date '2026-09-17',date '2026-09-17',1,198,'Mechanical',false,true,202,0),
  (204,1,22,'Final Design Sign-Off (External)',5,date '2026-09-18',date '2026-09-22',1,198,'Mechanical',false,true,203,0),
  (205,1,23,'PR Standard Part List B (common parts)',1,date '2026-09-23',date '2026-09-23',1,198,'Mechanical',false,false,204,0),
  (206,1,24,'Electrical Engineering',34,date '2026-08-20',date '2026-09-22',0,null,'Electrical',true,true,null,0),
  (207,1,25,'I/O List',14,date '2026-08-20',date '2026-09-02',1,206,'Electrical',false,true,197,0),
  (208,1,26,'Electrical Circuit',14,date '2026-09-03',date '2026-09-16',1,206,'Electrical',false,true,207,0),
  (209,1,27,'Final Design Sign-Off (External)',5,date '2026-09-17',date '2026-09-21',1,206,'Electrical',false,true,208,0),
  (210,1,28,'PR Standard Part List B (common parts)',1,date '2026-09-22',date '2026-09-22',1,206,'Electrical',false,true,209,0),
  (211,1,29,'Software Design & Development',35,date '2026-08-20',date '2026-09-23',0,null,'Software/Controls',true,true,null,0),
  (212,1,30,'Programming Flow Chart',5,date '2026-08-20',date '2026-08-24',1,211,'Software/Controls',false,true,191,0),
  (213,1,31,'Programming Code',24,date '2026-08-25',date '2026-09-17',1,211,'Software/Controls',false,true,212,0),
  (214,1,32,'Final Design Sign-Off',5,date '2026-09-18',date '2026-09-22',1,211,'Software/Controls',false,true,213,0),
  (215,1,33,'Test Protocol/Buy-Off Checklist',1,date '2026-09-23',date '2026-09-23',1,211,'Software/Controls',false,true,214,0),
  (216,1,34,'Procurement',93,date '2026-07-28',date '2026-10-28',0,null,'Procurement',true,true,null,0),
  (217,1,35,'Mechanical Standard Parts A',70,date '2026-07-28',date '2026-10-05',1,216,'Procurement',false,true,184,0),
  (218,1,36,'Mechanical Standard Parts B',36,date '2026-09-23',date '2026-10-28',1,216,'Procurement',false,true,204,0),
  (219,1,37,'Electrical Standard Parts A',70,date '2026-07-28',date '2026-10-05',1,216,'Procurement',false,true,184,0),
  (220,1,38,'Electrical Standard Parts B',36,date '2026-09-22',date '2026-10-27',1,216,'Procurement',false,true,209,0),
  (221,1,39,'Manufacturing',44,date '2026-09-17',date '2026-10-30',0,null,'Manufacturing',true,true,null,0),
  (222,1,40,'Parts Fabrication',30,date '2026-09-17',date '2026-10-16',1,221,'Manufacturing',false,true,202,0),
  (223,1,41,'Parts Modification',14,date '2026-10-17',date '2026-10-30',1,221,'Manufacturing',false,true,222,0),
  (224,1,42,'Assembly',23,date '2026-10-09',date '2026-10-31',0,null,'Assembly',true,true,null,0),
  (225,1,43,'Machine Assembly',21,date '2026-10-09',date '2026-10-29',1,224,'Assembly',false,true,null,0),
  (226,1,44,'Pneumatic',7,date '2026-10-22',date '2026-10-28',1,224,'Assembly',false,true,null,0),
  (227,1,45,'Panel Wiring',10,date '2026-10-09',date '2026-10-18',1,224,'Assembly',false,true,null,0),
  (228,1,46,'Machine Wiring',10,date '2026-10-22',date '2026-10-31',1,224,'Assembly',false,true,null,0),
  (229,1,47,'Debugging & Test-Run',26,date '2026-10-30',date '2026-11-24',0,null,'Debug & Test',true,true,null,0),
  (230,1,48,'Wiring Debugging',2,date '2026-11-01',date '2026-11-02',1,229,'Debug & Test',false,true,228,0),
  (231,1,49,'Program Debugging',8,date '2026-11-03',date '2026-11-10',1,229,'Debug & Test',false,true,230,0),
  (232,1,50,'Machine Alignment',1,date '2026-10-30',date '2026-10-30',1,229,'Debug & Test',false,true,225,0),
  (233,1,51,'Test-Run',14,date '2026-11-11',date '2026-11-24',1,229,'Debug & Test',false,true,231,0),
  (234,1,52,'Quality Inspection',8,date '2026-11-25',date '2026-12-02',0,null,'QA',true,true,null,0),
  (235,1,53,'Internal Acceptance Test by QA Personnel',1,date '2026-11-25',date '2026-11-25',1,234,'QA',false,true,233,0),
  (236,1,54,'Factory Acceptance Test (FAT) by Customer',7,date '2026-11-26',date '2026-12-02',1,234,'QA',false,true,235,0),
  (237,2,1,'Shipment',8,date '2026-12-03',date '2026-12-10',0,null,'Logistics',true,true,null,0),
  (238,2,2,'Improvement activities before shipment',5,date '2026-12-03',date '2026-12-07',1,237,'Logistics',false,true,236,0),
  (239,2,3,'Shipping Authorization Form',1,date '2026-12-08',date '2026-12-08',1,237,'Logistics',false,true,238,0),
  (240,2,4,'Photo Taking',1,date '2026-12-08',date '2026-12-08',1,237,'Logistics',false,true,238,0),
  (241,2,5,'Inform customer on machine delivery',1,date '2026-12-08',date '2026-12-08',1,237,'Logistics',false,true,238,0),
  (242,2,6,'Packing',1,date '2026-12-09',date '2026-12-09',1,237,'Logistics',false,true,239,0),
  (243,2,7,'Delivery & Custom Clearance',1,date '2026-12-10',date '2026-12-10',1,237,'Logistics',false,true,242,0),
  (244,2,8,'Documentation',7,date '2026-12-10',date '2026-12-16',0,null,'Documentation',true,true,null,0),
  (245,2,9,'Operational Manual Preparation',7,date '2026-12-10',date '2026-12-16',1,244,'Documentation',false,true,242,0),
  (246,2,10,'Installation Completed',14,date '2026-12-14',date '2026-12-27',0,null,'Installation',false,true,null,0),
  (247,2,11,'Site Acceptance & Hand-Over',5,date '2026-12-29',date '2027-01-02',0,null,'Installation',false,true,null,0),
  (248,2,12,'Data & Knowledge Management',7,date '2027-01-03',date '2027-01-09',0,null,'Documentation',true,true,null,0),
  (249,2,13,'Compile Project Documents (Hardcopy & Softcopy)',6,date '2027-01-03',date '2027-01-08',1,248,'Documentation',true,true,null,0),
  (250,2,14,'Mechanical Drawings',1,date '2027-01-03',date '2027-01-03',2,249,'Documentation',false,true,247,0),
  (251,2,15,'Pneumatic/Hydraulic Schematic',1,date '2027-01-04',date '2027-01-04',2,249,'Documentation',false,true,250,0),
  (252,2,16,'I/O List',1,date '2027-01-05',date '2027-01-05',2,249,'Documentation',false,true,251,0),
  (253,2,17,'Electrical Circuit',1,date '2027-01-06',date '2027-01-06',2,249,'Documentation',false,true,252,0),
  (254,2,18,'Program',1,date '2027-01-07',date '2027-01-07',2,249,'Documentation',false,true,253,0),
  (255,2,19,'Standard Part List',1,date '2027-01-08',date '2027-01-08',2,249,'Documentation',false,true,254,0),
  (256,2,20,'Compile Project References - Library',1,date '2027-01-09',date '2027-01-09',1,248,'Documentation',false,true,255,0)
) as v(id, phase, task_no, description, duration_days, planned_start, planned_finish, indent_level, parent_id, department, is_summary, is_active, predecessor_id, lag_days)
where not exists (select 1 from nixma.tasks where id = v.id);
