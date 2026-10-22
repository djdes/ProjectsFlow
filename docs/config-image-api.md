Config uses the same image queue as `/ai` through `/api/ai/image-jobs`.

The image router must be mounted before the session-only `/api/ai` conversation
router. It accepts existing browser sessions and account Bearer tokens. A valid
Bearer token must not be rejected by the broader conversation router. Project
tokens are denied; ownership still controls status and file access.

`POST /api/ai/image-jobs` accepts the existing JSON request or multipart with
`prompt`, optional `conversationId`, `width`, `height`, and up to eight `images`
(PNG/JPEG, 6 MiB each, 24 MiB combined). Inputs are persisted before publishing
the job. The claimed dispatcher receives them with the claim. Individual status
is available at `GET /api/ai/image-jobs/:id`. Existing chat authorization remains
in force for conversation-bound images.

Config art briefs use the existing agent `ai-prompt-jobs` queue in `assistant`
mode under the C#Config project. The local Config product worker runs official
Codex and returns the text; this does not enable the server LLM gateway or alter
`llm_settings.server_queues`. Image generation continues through the separate
native-image worker.

Validated: image service and route tests, including conversation ownership,
account tokens, multipart references, invalid input and authenticated PNG access.
