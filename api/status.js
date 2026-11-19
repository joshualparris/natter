// Reports which optional features are configured (no secrets returned).
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    voice: !!(process.env.CARTESIA_API_KEY && process.env.CARTESIA_AGENT_ID),
    memory: !!process.env.ANTHROPIC_API_KEY,
    text: !!process.env.ANTHROPIC_API_KEY,
    web: !!process.env.ANTHROPIC_API_KEY,
    calendar: !!process.env.GOOGLE_CALENDAR_ICS_URL,
    passcode: !!process.env.APP_PASSCODE,
  });
}
