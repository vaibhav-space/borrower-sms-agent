import { z } from 'zod';
import {
  InboundSMSSchema,
  ActionEnum,
  ToolCallRecordSchema,
  AgentOutputSchema,
  GetBalanceOutputSchema,
  MarkOptOutOutputSchema,
  CreatePaymentLinkOutputSchema,
  ToolErrorOutputSchema
} from './schemas.js';

export type InboundSMS = z.infer<typeof InboundSMSSchema>;
export type AgentAction = z.infer<typeof ActionEnum>;
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
export type AgentOutput = z.infer<typeof AgentOutputSchema>;
export type GetBalanceOutput = z.infer<typeof GetBalanceOutputSchema>;
export type MarkOptOutOutput = z.infer<typeof MarkOptOutOutputSchema>;
export type CreatePaymentLinkOutput = z.infer<typeof CreatePaymentLinkOutputSchema>;
export type ToolErrorOutput = z.infer<typeof ToolErrorOutputSchema>;

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  balance: number;
  currency: string;
  isOptedOut: boolean;
}

export type ToolResult =
  | GetBalanceOutput
  | MarkOptOutOutput
  | CreatePaymentLinkOutput
  | ToolErrorOutput;
