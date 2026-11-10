/** Keeps asynchronous imports attached to the session that started them. */
export type ImportSessionLease = number;

export class ImportSessionController {
  private version = 0;
  private activeLease: ImportSessionLease | null = null;

  start(): ImportSessionLease | null {
    if (this.activeLease !== null) return null;
    const lease = ++this.version;
    this.activeLease = lease;
    return lease;
  }

  cancel(): void {
    this.version++;
    this.activeLease = null;
  }

  isActive(lease: ImportSessionLease): boolean {
    return this.activeLease === lease;
  }

  finish(lease: ImportSessionLease): boolean {
    if (!this.isActive(lease)) return false;
    this.activeLease = null;
    return true;
  }
}
