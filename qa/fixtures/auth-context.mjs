// Test-only request identity. Used solely by the isolated jiti route harness.
export async function getCurrentUser() {
  const userId = process.env.BASELINE_AUTH_USER;
  return userId
    ? {
        userId,
        email: "baseline@example.invalid",
        name: "QA",
        englishLevel: "intermediate",
        hasCompletedOnboarding: true,
        membershipTier: "free",
      }
    : null;
}
