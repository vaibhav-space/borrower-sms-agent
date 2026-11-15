import { ComplianceConfig, DEFAULT_COMPLIANCE_CONFIG } from './config/compliance.config.js';
import { CustomerRecord } from './types.js';

export class ComplianceEngine {
  private config: ComplianceConfig;
  private optOutSet: Set<string>;

  constructor(customConfig?: Partial<ComplianceConfig>) {
    this.config = {
      ...DEFAULT_COMPLIANCE_CONFIG,
      ...customConfig,
      quietHours: {
        ...DEFAULT_COMPLIANCE_CONFIG.quietHours,
        ...(customConfig?.quietHours ?? {})
      }
    };
    this.optOutSet = new Set(this.config.optOutKeywords.map((k) => k.toUpperCase()));
  }

  public isOptOut(message: string): boolean {
    const normalized = message.trim().replace(/[.!?,]+$/, '').toUpperCase();
    return this.optOutSet.has(normalized);
  }

  public isQuietHours(
    receivedAt: string,
    timezone: string
  ): { isQuiet: boolean; localHour?: number; reason?: string } {
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
      const { startHour, endHour } = this.config.quietHours;
      if (hour < startHour || hour >= endHour) {
        return {
          isQuiet: true,
          localHour: hour,
          reason: `Local time (${hour}:00) is outside permissible hours (${startHour.toString().padStart(2, '0')}:00-${endHour}:00)`
        };
      }

      return { isQuiet: false, localHour: hour };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown timezone error';
      return { isQuiet: true, reason: `Timezone error: ${message}` };
    }
  }

  /**
   * Evaluates if inbound message expresses a dispute or payment contention.
   * Negation-aware: checks for "no dispute" or "not disputing" to prevent false positives.
   */
  public isDispute(message: string): boolean {
    const lower = message.toLowerCase();

    // Check for explicit negations e.g. "no dispute", "not disputing"
    if (/\b(no\s+dispute|not\s+disputing|never\s+disputed)\b/i.test(lower)) {
      return false;
    }

    return this.config.disputeKeywords.some((keyword) => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      return regex.test(lower);
    });
  }

  public isAskingForAmount(message: string): boolean {
    const lower = message.toLowerCase();
    return this.config.amountInquiryKeywords.some((keyword) => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      return regex.test(lower);
    });
  }

  public containsMonetaryAmount(text: string): boolean {
    // Matches dollar signs with digits (e.g., $1,450.00, $50), or digits followed by USD / dollars
    const moneyRegex = /(\$\s*\d+(?:,\d{3})*(?:\.\d{2})?|\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:usd|dollars)\b)/i;
    return moneyRegex.test(text);
  }

  /**
   * Scans draft reply for data belonging to other customers (privacy guardrail).
   */
  public containsForeignCustomerData(
    reply: string,
    currentCustomerId: string,
    allCustomers: CustomerRecord[]
  ): { hasLeak: boolean; leakedEntity?: string } {
    const foreignCustomers = allCustomers.filter((c) => c.id !== currentCustomerId);
    const replyLower = reply.toLowerCase();

    for (const foreign of foreignCustomers) {
      // Check customer ID
      if (replyLower.includes(foreign.id.toLowerCase())) {
        return { hasLeak: true, leakedEntity: `Customer ID ${foreign.id}` };
      }
      // Check full name (case-insensitive)
      if (replyLower.includes(foreign.name.toLowerCase())) {
        return { hasLeak: true, leakedEntity: `Customer Name ${foreign.name}` };
      }
      // Check phone number
      const cleanPhone = foreign.phone.replace(/[^0-9]/g, '');
      const cleanReply = reply.replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 7 && cleanReply.includes(cleanPhone)) {
        return { hasLeak: true, leakedEntity: `Customer Phone ${foreign.phone}` };
      }
      // Check foreign balance if unique and non-zero
      if (foreign.balance > 0) {
        const formatted = foreign.balance.toFixed(2);
        if (reply.includes(`$${formatted}`) || reply.includes(formatted)) {
          return { hasLeak: true, leakedEntity: `Customer Balance $${formatted}` };
        }
      }
    }

    return { hasLeak: false };
  }

  public getSafeFirstReplyTemplate(): string {
    return this.config.safeFirstReplyTemplate;
  }
}
