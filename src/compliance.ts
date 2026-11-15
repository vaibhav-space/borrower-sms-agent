export class ComplianceEngine {
  private static readonly OPT_OUT_KEYWORDS = new Set([
    'STOP',
    'UNSUBSCRIBE',
    'CANCEL',
    'QUIT',
    'END'
  ]);

  public static isOptOut(message: string): boolean {
    const normalized = message.trim().replace(/[.!?,]+$/, '').toUpperCase();
    return this.OPT_OUT_KEYWORDS.has(normalized);
  }

  /**
   * Evaluates if the message timestamp falls within permitted borrower communication
   * hours (8:00 AM to 9:00 PM) in the customer's local timezone under TCPA / CFPB Reg F.
   */
  public static isQuietHours(receivedAt: string, timezone: string): { isQuiet: boolean; localHour?: number; reason?: string } {
    try {
      const date = new Date(receivedAt);
      if (isNaN(date.getTime())) {
        return { isQuiet: true, reason: 'Invalid receivedAt timestamp format' };
      }

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hourCycle: 'h23'
      });

      const parts = formatter.formatToParts(date);
      const hourPart = parts.find((p) => p.type === 'hour');
      if (!hourPart) {
        return { isQuiet: true, reason: 'Failed to extract hour from timezone' };
      }

      const hour = parseInt(hourPart.value, 10);
      // TCPA / Reg F: 08:00 - 21:00 (8:00 AM to 9:00 PM) permitted
      if (hour < 8 || hour >= 21) {
        return {
          isQuiet: true,
          localHour: hour,
          reason: `Local time (${hour}:00) is outside permissible hours (08:00-21:00)`
        };
      }

      return { isQuiet: false, localHour: hour };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown timezone error';
      return { isQuiet: true, reason: `Timezone error: ${message}` };
    }
  }
}
