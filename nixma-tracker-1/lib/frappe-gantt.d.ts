declare module "frappe-gantt" {
  export default class Gantt {
    constructor(wrapper: HTMLElement | string, tasks: unknown[], options?: Record<string, unknown>);
  }
}
