# OpenAI Image Generation Prompt

Provider mode: dry-run scaffold.

Use this prompt only through an approved provider request. Default CLI and tests must not call OpenAI ImageGen.

Inputs:

- Creative job manifest.
- Approved local reference assets.
- Human-reviewed browser captures or trend examples.

Task:

Generate or plan 9:16 visual assets for the requested post package, matching the job's slide directions and keeping text overlays separate for the local renderer.

Rules:

- Use only approved local inputs.
- Avoid claims of exact resale value unless supplied by the job manifest.
- Do not include credentials, private account UI, private messages, or seller contact information.
- Return outputs into the declared rendered package subdirectory only.
