export const resetE2EState = async (request) => {
  const response = await request.get('/__e2e/reset');

  if (!response.ok()) {
    throw new Error(`Failed to reset E2E state (${response.status()}).`);
  }
};
