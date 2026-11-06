/** Next calls this once per server process: start the background-job runner (D-133), never in `next build`. */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startJobRunner } = await import('./server/job-runner');
    startJobRunner();
  }
}
