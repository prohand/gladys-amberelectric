# Security policy

## Supported versions

Only the latest release of the Amber Electric integration receives security
fixes. Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-amberelectric](https://github.com/prohand/gladys-amberelectric/security),
then **Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove your Amber API token, your NMI and your
  addresses first).

You should get a first answer within 7 days. A fix is released as a new version
of the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)) and
the Amber Electric services and API this integration talks to (report to Amber
Electric).

## How the integration handles your data

- The Amber API token is stored in a secret field of Gladys, sent only to
  `https://api.amber.com.au` as a Bearer header, and never written to the logs,
  even with detailed logs turned on.
- The integration only reads: your sites (NMI, channels) and your prices. It
  never reads your usage history and never changes anything on your Amber
  account.
- Nothing is written to disk: the last prices are kept in memory only.

## Good practices for users

- Create a token dedicated to Gladys on app.amber.com.au, and revoke it there if
  you uninstall the integration or think it leaked.
- Keep Gladys and the integration up to date.
