import { test, expect } from '@playwright/test';

test.describe('Mars Miners Multiplayer Flow', () => {
  test('should show multiplayer selection modal and navigate correctly', async ({ page }) => {
    // 1. Navigate to the home page
    await page.goto('/');

    // 2. Click the Multiplayer button
    const multiBtn = page.getByTestId('multiplayer-button');
    await expect(multiBtn).toBeVisible();
    await multiBtn.click();

    // 3. Verify the selection modal is visible
    const createBtn = page.getByTestId('create-battle-button');
    const joinBtn = page.getByTestId('join-battle-button');
    await expect(createBtn).toBeVisible();
    await expect(joinBtn).toBeVisible();

    // 4. Test Create Battle flow
    await createBtn.click();
    
    // Verify the Session ID modal is visible
    const okBtn = page.getByTestId('session-modal-ok');
    const copyBtn = page.getByTestId('copy-session-button');
    await expect(okBtn).toBeVisible();
    await expect(copyBtn).toBeVisible();
    
    // Check if the session ID is displayed
    await expect(page.locator('text=Session ID:')).toBeVisible();
    
    // Click OK to proceed to the game
    await okBtn.click();
    
    // Verify navigation to the game screen with multiplayer parameters
    await expect(page).toHaveURL(/.*\/game/);
    await expect(page).toHaveURL(/.*session_id=.*/);
    await expect(page).toHaveURL(/.*mode=multi.*/);
    
    // Verify game grid is visible
    await expect(page.getByTestId('game-cell').first()).toBeVisible();

    // 5. Go back to Home
    await page.goto('/');

    // 6. Test Join Battle flow
    await page.getByTestId('multiplayer-button').click();
    await page.getByTestId('join-battle-button').click();

    // Verify navigation to the multiplayer (Join) screen
    await expect(page).toHaveURL(/.*\/multiplayer/);
    
    // Verify that the Join Game button is visible on this screen
    // (Note: Join Game button is disabled until a session ID is entered)
    await expect(page.getByTestId('join-game-final-button')).toBeVisible();
  });
});
