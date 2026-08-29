## 2026-08-29 - [Added rel='noopener noreferrer' to target='_blank' links]
**Vulnerability:** External links with target='_blank' used only rel='noopener' which is missing 'noreferrer'.
**Learning:** While 'noopener' mitigates window.opener hijacking, omitting 'noreferrer' can leak referrer information and poses a risk in older browsers. It is safer to use both.
**Prevention:** Always use rel='noopener noreferrer' together when using target='_blank'.
