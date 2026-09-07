# Contributing

PaneCrew is currently a solo-maintained project without a formal contribution process. That said,
contributions are welcome — just keep expectations in mind below.

## Reporting bugs / requesting features

Use [Issues](https://github.com/silvio-l/panecrew/issues) with the provided templates. Include
your PaneCrew version, VS Code version, and OS — the bug report template asks for these.

## Questions / discussion

Use [Discussions](https://github.com/silvio-l/panecrew/discussions) for usage questions or ideas
that aren't yet a concrete bug/feature request.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Pull requests

- Open an issue first for anything beyond a trivial fix, so the approach can be agreed on before
  you invest time in an implementation.
- Keep PRs focused and small; unrelated changes make review slower.
- Run the existing checks before opening a PR:
  `pnpm --filter panecrew --dir apps/extension run compile` and
  `pnpm --filter panecrew --dir apps/extension run test:unit`.
- Follow the existing code style; comments and commit messages are in English.

Review is best-effort, alongside other work — there is no guaranteed turnaround time.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
