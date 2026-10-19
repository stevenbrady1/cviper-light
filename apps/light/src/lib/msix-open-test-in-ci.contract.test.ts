/**
 * The Store package is installed and OPENED on the runner (L-259).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The Windows App Certification Kit reads the package and never runs it — its
 * own report says "Running tests without application deployment". So a package
 * can PASS every check and still fail to draw a window, and until somebody
 * installs it nobody knows which. docs/STORE-SUBMISSION.md Step 4a had the
 * owner do that once per build, by hand, on a real PC: trust a throwaway
 * certificate machine-wide, install, open, uninstall, untrust by thumbprint.
 * Ten minutes, and a certificate the owner's PC must not be left trusting.
 *
 * msix.yml now does it on the runner, which is thrown away afterwards. This
 * test holds that step in place and holds it honest: it must really install
 * the package (not `-AllowUnsigned`, which does not apply to a signed one),
 * really launch it through the shell so Windows activates it as a packaged
 * app, really wait for a WINDOW rather than a process, and really tidy up —
 * the certificate by THUMBPRINT, never by subject name, because the
 * throwaway certificate carries the same CN as the real Store publisher.
 *
 * It must also be able to fail. A step whose failure is swallowed, or that is
 * skipped whenever the certification kit is, is the manual test with the
 * human taken out and nothing put back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const MSIX = join(REPO_ROOT, '.github', 'workflows', 'msix.yml');

function withoutComments(workflow: string): string {
  return workflow
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');
}

/** Each `- name:` step of the (single) job, as text, in order. */
export function steps(workflow: string): string[] {
  const body = withoutComments(workflow).split(/^\s{4}steps:\s*$/m)[1] ?? '';
  return body.split(/^(?=\s{6}- name:)/m).filter((step) => /^\s{6}- name:/.test(step));
}

/** The one step that installs the package, or `undefined`. */
export function openTestStep(workflow: string): string | undefined {
  return steps(workflow).find((step) => /Add-AppxPackage\b/.test(step));
}

export function openTestOffences(workflow: string): string[] {
  const all = steps(workflow);
  const step = openTestStep(workflow);
  if (step === undefined) {
    return [
      'no step runs Add-AppxPackage, so the package is never installed anywhere before it is submitted.',
    ];
  }
  const offences: string[] = [];

  if (/Add-AppxPackage[^\n]*-AllowUnsigned/.test(step)) {
    offences.push(
      'the install passes -AllowUnsigned, which does not apply to a signed package and would install a different identity from the one submitted.',
    );
  }
  if (!/Import-Certificate[^\n]*TrustedPeople/.test(step)) {
    offences.push(
      'the step does not trust the development certificate in TrustedPeople first, so the install cannot succeed for the right reason.',
    );
  }
  if (!/shell:AppsFolder/.test(step)) {
    offences.push(
      'the app is not launched through shell:AppsFolder, so Windows never activates it as a packaged app.',
    );
  }
  if (!/MainWindowHandle/.test(step)) {
    offences.push(
      'the step does not wait for a window (MainWindowHandle), so a process that starts and never draws would pass.',
    );
  }
  if (!/Remove-AppxPackage/.test(step)) {
    offences.push('the package is never removed, so the uninstall path is never exercised.');
  }
  if (!/Remove-Item[^\n]*TrustedPeople\\\$/.test(step)) {
    offences.push('the certificate is not removed by thumbprint variable.');
  }
  if (/Where-Object[^\n]*Subject[^\n]*CN=/.test(step)) {
    offences.push(
      'the certificate is matched by subject name, which is shared with the real Store publisher.',
    );
  }
  if (/continue-on-error:\s*true/.test(step) || /\|\|\s*(true|exit 0)/.test(step)) {
    offences.push("the step's failure is swallowed, so it can never go red.");
  }
  if (/^\s{8}if:.*RUN_WACK/m.test(step)) {
    offences.push(
      'the step is gated on the certification kit, so turning the kit off also turns the open test off.',
    );
  }

  const index = all.indexOf(step);
  const upload = all.findIndex((candidate) => /upload-artifact@/.test(candidate));
  if (upload !== -1 && index > upload) {
    offences.push(
      'the open test runs after the artefact is uploaded, so its evidence never reaches the artefact.',
    );
  }
  return offences;
}

const STEP = (run: string): string => `jobs:
  msix:
    runs-on: windows-latest
    steps:
      - name: Install the package, open the app, and prove it draws a window
        shell: pwsh
        run: |
${run
  .split('\n')
  .map((line) => `          ${line}`)
  .join('\n')}
      - name: Upload the package
        uses: actions/upload-artifact@abc
`;

const GOOD = `Import-Certificate -FilePath x.cer -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople
Add-AppxPackage -Path $env:MSIX_PATH
Start-Process "shell:AppsFolder\\$aumid"
if ($proc.MainWindowHandle -eq 0) { exit 1 }
Remove-AppxPackage -Package $pkg.PackageFullName
Remove-Item -Path "Cert:\\LocalMachine\\TrustedPeople\\$thumbprint"`;

describe('msix.yml installs and opens the Store package on the runner', () => {
  it('the real workflow is clean', () => {
    expect(openTestOffences(readFileSync(MSIX, 'utf8'))).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('happy: a complete step passes', () => {
    expect(openTestOffences(STEP(GOOD))).toEqual([]);
  });

  it('negative: no install at all', () => {
    expect(openTestOffences(STEP('Write-Host nothing'))).toHaveLength(1);
  });

  it('negative: -AllowUnsigned is the wrong way in', () => {
    const bad = GOOD.replace(
      'Add-AppxPackage -Path $env:MSIX_PATH',
      'Add-AppxPackage -AllowUnsigned -Path $env:MSIX_PATH',
    );
    expect(openTestOffences(STEP(bad)).some((o) => o.includes('-AllowUnsigned'))).toBe(true);
  });

  it('negative: a process is not a window', () => {
    const bad = GOOD.replace(
      'if ($proc.MainWindowHandle -eq 0) { exit 1 }',
      'if ($null -eq $proc) { exit 1 }',
    );
    expect(openTestOffences(STEP(bad)).some((o) => o.includes('MainWindowHandle'))).toBe(true);
  });

  it('negative: untrusting by subject name', () => {
    const bad = GOOD.replace(
      'Remove-Item -Path "Cert:\\LocalMachine\\TrustedPeople\\$thumbprint"',
      'Get-ChildItem Cert:\\LocalMachine\\TrustedPeople | Where-Object Subject -like "CN=F08F*" | Remove-Item',
    );
    const offences = openTestOffences(STEP(bad));
    expect(offences.some((o) => o.includes('subject name'))).toBe(true);
    expect(offences.some((o) => o.includes('thumbprint'))).toBe(true);
  });

  it('negative: a swallowed failure', () => {
    expect(openTestOffences(STEP(`${GOOD} || true`)).some((o) => o.includes('swallowed'))).toBe(
      true,
    );
  });

  it('boundary: a commented-out install does not count', () => {
    expect(
      openTestOffences(STEP(GOOD.replace('Add-AppxPackage', '# Add-AppxPackage'))),
    ).toHaveLength(1);
  });

  it('boundary: running after the upload is too late', () => {
    const late = STEP(GOOD).replace(/ {6}- name: Upload[\s\S]*$/, '');
    const swapped = `jobs:
  msix:
    runs-on: windows-latest
    steps:
      - name: Upload the package
        uses: actions/upload-artifact@abc
${late.split('\n').slice(4).join('\n')}`;
    expect(openTestOffences(swapped).some((o) => o.includes('after the artefact'))).toBe(true);
  });
});
