// community/code-of-conduct — CODE_OF_CONDUCT.md present.
const CANDIDATES = ['CODE_OF_CONDUCT.md', '.github/CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT.txt', 'docs/CODE_OF_CONDUCT.md'];

export const codeOfConductRule = {
  id: 'community/code-of-conduct',
  title: 'CODE_OF_CONDUCT.md present',
  severity: 'error',
  tier: 'cheap',
  fixable: 'generate',
  docs: `Why: newcomers — especially from groups underrepresented in open
source — check for a code of conduct before engaging. Its absence signals
"nobody thought about what happens when things go wrong."

What dxlint checks: CODE_OF_CONDUCT.md exists at the repository root, in
.github/, in docs/, or as CODE_OF_CONDUCT.txt.

Pass example: CODE_OF_CONDUCT.md (e.g. Contributor Covenant v2.1).

Fixable: \`dxlint fix --apply\` creates a CODE_OF_CONDUCT.md stub pointing at
Contributor Covenant with a placeholder enforcement contact. It never edits an
existing file.`,
  evaluate(ctx) {
    for (const p of CANDIDATES) {
      if (ctx.fs.exists(p)) return [];
    }
    return [
      {
        severity: 'error',
        message: 'This repository has no code of conduct',
        evidence: `looked for ${CANDIDATES.join(', ')}`,
        remediation:
          'Add CODE_OF_CONDUCT.md (Contributor Covenant is the usual choice) with a contact for reports.',
        location: { path: 'CODE_OF_CONDUCT.md' },
        fixable: true,
      },
    ];
  },
  fix() {
    const content = `# Code of Conduct

## Our Pledge

We pledge to make participation in this project a harassment-free experience
for everyone, regardless of age, body size, disability, ethnicity, gender
identity and expression, level of experience, education, socio-economic status
nationality, personal appearance, race, religion, or sexual identity and
orientation.

## Standards

Examples of behavior that contributes to a positive environment:

* Being respectful of differing opinions and viewpoints
* Giving and gracefully accepting constructive feedback
* Focusing on what is best for the community

Examples of unacceptable behavior:

* Trolling, insulting or derogatory comments, and personal or political attacks
* Public or private harassment
* Publishing others' private information without explicit permission

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the project maintainers. All complaints will be reviewed and
investigated and will result in a response that is deemed necessary and
appropriate to the circumstances.

> **dxlint-generated stub.** Replace the enforcement paragraph above with a
> real contact (email or a GitHub Security Advisory / maintainer handle), and
> consider pasting the full text of Contributor Covenant v2.1
> (https://www.contributor-covenant.org/version/2/1/code_of_conduct.html).

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org), version 2.1.
`;
    return { path: 'CODE_OF_CONDUCT.md', content };
  },
};
