# Post Package QA Review Prompt

Review the rendered package before any manual posting decision.

Check:

- Source assets are local and approved.
- Captions and slides match the job manifest.
- Browser captures are human-reviewed.
- Provider outputs are present only in declared subdirectories.
- No generated file overwrote approved package files without an explicit overwrite flag.
- No paid provider call, browser UI workflow, or posting action occurred without the required environment gate.
- No credentials, private messages, seller contact details, or account setup material are present.

Output a short QA note with blockers, required edits, and approval status.
