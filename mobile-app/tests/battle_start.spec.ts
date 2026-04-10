import { test, expect } from '@playwright/test';

test.describe('Mars Miners Battle Start', () => {
  test('should start a 1 human and 3 AI battle correctly', async ({ page }) => {
    // 1. Navigate to the home page
    await page.goto('/');

    // 2. Click the New Game button to go to Setup
    const newGameBtn = page.getByTestId('new-game-button');
    await expect(newGameBtn).toBeVisible();
    await newGameBtn.click();

    // Ensure we transitioned to the setup screen (waiting for the start button)
    const startGameBtn = page.getByTestId('start-game-button');
    await expect(startGameBtn).toBeVisible({ timeout: 20000 });

    // 4. Configure Players (1 Human + 3 AI)
    // Defaults: P1=human, P2=normal_ai, P3=none, P4=none
    
    // Cycle Player 3 (none -> human -> easy_ai)
    const p3Btn = page.getByTestId('role-button-3');
    await p3Btn.click(); // to human
    await p3Btn.click(); // to easy_ai
    
    // Cycle Player 4 (none -> human -> easy_ai)
    const p4Btn = page.getByTestId('role-button-4');
    await p4Btn.click(); // to human
    await p4Btn.click(); // to easy_ai

    // 5. Start the Game
    await startGameBtn.click();

    // 6. Verify navigation to the game screen
    await expect(page).toHaveURL(/.*\/game/);

    // 7. Verify the game grid is visible
    const firstCell = page.getByTestId('game-cell').first();
    await expect(firstCell).toBeVisible();

    // 8. Verify the turn indicator shows it's a turn (not replay mode)
    // We check for the text "TURN:" which is in the status text
    await expect(page.locator('text=/TURN:/i')).toBeVisible();
  });
});
