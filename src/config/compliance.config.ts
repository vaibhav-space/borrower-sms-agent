export interface ComplianceConfig {
  optOutKeywords: string[];
  disputeKeywords: string[];
  amountInquiryKeywords: string[];
  quietHours: {
    startHour: number; // e.g. 8 (8:00 AM)
    endHour: number;   // e.g. 21 (9:00 PM)
  };
  safeFirstReplyTemplate: string;
}

export const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = {
  optOutKeywords: [
    'STOP',
    'UNSUBSCRIBE',
    'CANCEL',
    'QUIT',
    'END',
    'REVOKE',
    'STOPALL'
  ],
  disputeKeywords: [
    'dispute',
    'disputing',
    'not my debt',
    'not my loan',
    'not my account',
    'already paid',
    'paid in full',
    'paid this',
    'fraud',
    'identity theft',
    'wrong person',
    'mistake',
    'inaccurate',
    'unauthorized',
    'lawyer',
    'attorney',
    'cease and desist',
    'bankruptcy',
    'discharge',
    'scam'
  ],
  amountInquiryKeywords: [
    'how much',
    'balance',
    'what do i owe',
    'amount owed',
    'payoff',
    'owe',
    'total due',
    'total',
    'due'
  ],
  quietHours: {
    startHour: 8,
    endHour: 21
  },
  safeFirstReplyTemplate:
    'Hello, thank you for reaching out. How can we assist you with your account today?'
};
