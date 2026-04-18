/**
 * E2E: Clicking "+ Agent" → "Copilot CLI" spawns a mock Copilot terminal.
 *
 * Assertions:
 *   1. The mock `copilot` binary was invoked (invocations.log exists and is non-empty).
 *   2. The expected events.jsonl session file was created in the isolated HOME.
 *   3. A VS Code terminal named "Copilot CLI #1" appears in the workbench.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { launchVSCode, waitForWorkbench } from '../helpers/launch';
import {
  clickAddCopilotAgent,
  getPixelAgentsFrame,
  openPixelAgentsPanel,
} from '../helpers/webview';

test('clicking + Agent and selecting Copilot CLI spawns mock copilot and creates events.jsonl', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, tmpHome, mockCopilotLogFile } = session;
  const runVideo = window.video();

  test.setTimeout(120_000);

  try {
    // 1. Wait for VS Code workbench to be ready
    await waitForWorkbench(window);

    // 2. Open the Pixel Agents panel
    await openPixelAgentsPanel(window);

    // 3. Find the webview frame and click + Agent → Copilot CLI
    const frame = await getPixelAgentsFrame(window);
    await clickAddCopilotAgent(frame);

    // 4. Assert: mock copilot was invoked
    await expect
      .poll(
        () => {
          try {
            const content = fs.readFileSync(mockCopilotLogFile, 'utf8');
            return content.trim().length > 0;
          } catch {
            return false;
          }
        },
        {
          message: `Expected invocations.log at ${mockCopilotLogFile} to be non-empty`,
          timeout: 20_000,
          intervals: [500, 1000],
        },
      )
      .toBe(true);

    const invocationLog = fs.readFileSync(mockCopilotLogFile, 'utf8');
    expect(invocationLog).toContain('session-id=');
    await testInfo.attach('mock-copilot-invocations', {
      body: invocationLog,
      contentType: 'text/plain',
    });

    // 5. Assert: events.jsonl session file was created.
    const sessionStateDir = path.join(tmpHome, '.copilot', 'session-state');

    const findEventsJsonl = (): string[] => {
      try {
        if (!fs.existsSync(sessionStateDir)) return [];
        return fs.readdirSync(sessionStateDir).flatMap((entry) => {
          const sub = path.join(sessionStateDir, entry);
          try {
            return fs.statSync(sub).isDirectory()
              ? fs.readdirSync(sub).filter((f) => f === 'events.jsonl')
              : [];
          } catch {
            return [];
          }
        });
      } catch {
        return [];
      }
    };

    await expect
      .poll(findEventsJsonl, {
        message: `Expected events.jsonl file under ${sessionStateDir}`,
        timeout: 20_000,
        intervals: [500, 1000],
      })
      .not.toHaveLength(0);

    await testInfo.attach('events-jsonl-files', {
      body: findEventsJsonl().join('\n'),
      contentType: 'text/plain',
    });

    // 6. Assert: terminal "Copilot CLI #1" is visible in VS Code UI
    const terminalTab = window.getByText(/Copilot CLI #\d+/);
    await expect(terminalTab.first()).toBeVisible({ timeout: 15_000 });
  } finally {
    // Save a screenshot of the final state regardless of outcome
    const screenshotPath = path.join(
      __dirname,
      '../../test-results/e2e',
      `copilot-spawn-final-${Date.now()}.png`,
    );
    try {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await window.screenshot({ path: screenshotPath });
      await testInfo.attach('final-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } catch {
      // screenshot failure is non-fatal
    }

    await session.cleanup();

    if (runVideo) {
      try {
        const videoPath = testInfo.outputPath('run-video.webm');
        await runVideo.saveAs(videoPath);
        await testInfo.attach('run-video', {
          path: videoPath,
          contentType: 'video/webm',
        });
      } catch {
        // video attachment failure is non-fatal
      }
    }
  }
});
