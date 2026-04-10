import { test, expect } from '@playwright/test';

test.describe('Mars Miners Training Mode', () => {
  test('should start training mode correctly', async ({ page }) => {
    // 1. Navigate to the home page
    await page.goto('/');

    // 2. Check if the title is present (validating page load)
    await expect(page.locator('text=MARS MINERS')).toBeVisible();

    // 3. Click the Training button
    // Note: Expo web renders testID as data-testid by default
    const trainingBtn = page.getByTestId('training-button');
    await expect(trainingBtn).toBeVisible();
    await trainingBtn.click();

    // 4. Verify that the Training Rules modal appeared
    // We check for the rules title (localized key 'training_rules_title')
    // Since we don't have the exact text here, we look for the button in the modal
    const startConfirmBtn = page.getByTestId('start-training-confirm');
    await expect(startConfirmBtn).toBeVisible({ timeout: 10000 });

    // 5. Click Start Training to proceed to the game
    await startConfirmBtn.click();

    // 6. Verify navigation to the game screen
    // The URL should contain /game
    await expect(page).toHaveURL(/.*\/game/);

    // 7. Verify that the game grid or a game-specific element is visible
    // For example, looking for turn indicator or a grid cell
    const firstCell = page.getByTestId('game-cell').first();
    await expect(firstCell).toBeVisible();
  });
});
