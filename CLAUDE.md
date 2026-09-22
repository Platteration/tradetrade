@AGENTS.md

# tradetrade

An empty placeholder: the project has no code yet, and what it will trade is not yet decided.

There is no CI workflow, `.github/dependabot.yml`, `.nvmrc` or conventions test here yet:
they arrive with the first code. Dependabot errors on a directory without a manifest, and
a workflow with nothing to run is noise.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. The repository's check command (`npm run check`, or
`ruff check .` then `pytest -q` in a Python repository) is the gate before a push. To
change a convention, change it in every repository in one pass and update the hashes in
the test.
