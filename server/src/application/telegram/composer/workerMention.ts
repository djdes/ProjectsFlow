// A standalone Russian keyword also routes to the worker. Keep it in the task text:
// removing a noun from "проверить воркер" would change the meaning of the request.
// Unicode boundaries avoid matching names such as "воркеризация" or @воркер_team.
export function extractWorkerMention(text: string): { text: string; requested: boolean } {
  let requested = /(^|[^\p{L}\p{N}_@/.])воркер(?:а|у|ом|е)?(?=$|[^\p{L}\p{N}_])/iu.test(text);
  const cleaned = text.replace(
    /(^|\s)@(worker|воркер|ralph)(?=$|[\s,.:;!?])[,.:;!?]?/giu,
    (_match, space: string) => {
      requested = true;
      return space;
    },
  );
  return { text: cleaned.trim(), requested };
}
