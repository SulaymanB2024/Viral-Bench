# Gemini Image Generation Prompt

Provider mode: dry-run scaffold.

Use this prompt only through an approved provider request. Do not call Gemini from tests or default CLI paths.

Inputs:

- Approved creative job manifest.
- Operator-approved source images or listing screenshots.
- Trend examples that were manually captured and human-reviewed.

Task:

Create a 9:16 image plan for each slide in the creative job. Keep visuals native to short-form resale content: phone-camera framing, real item context, visible condition cues, and no polished studio look.

Rules:

- Do not invent a guaranteed appraisal, platform endorsement, or private seller detail.
- Do not render final text inside generated images unless the job explicitly requires it.
- Do not use private messages, seller contact details, credentials, or account UI.
- Return local artifact paths and review notes only after an approved provider implementation writes files into the rendered package folder.
