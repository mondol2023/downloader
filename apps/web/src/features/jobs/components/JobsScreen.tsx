import { JobList } from "./JobList";

export function JobsScreen() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10">
      <h1 className="font-display text-4xl">Downloads</h1>
      <JobList />
    </main>
  );
}
