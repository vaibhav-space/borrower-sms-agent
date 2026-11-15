import { z } from 'zod';

export const InboundSMSSchema = z.object({
  customerId: z.string().min(1, 'customerId is required'),
  message: z.string(),
  receivedAt: z.string().min(1, 'receivedAt is required'),
  customerTimezone: z.string().min(1, 'customerTimezone is required')
});

export const ActionEnum = z.enum(['send', 'hold', 'handoff']);

export const GetBalanceOutputSchema = z.object({
  balance: z.number(),
  currency: z.string()
});

export const MarkOptOutOutputSchema = z.object({
  optedOut: z.boolean(),
  success: z.boolean()
});

export const ToolErrorOutputSchema = z.object({
  error: z.string()
});

export const ToolCallRecordSchema = z.object({
  tool: z.enum(['getBalance', 'markOptOut']),
  input: z.object({
    customerId: z.string()
  }),
  output: z.union([
    GetBalanceOutputSchema,
    MarkOptOutOutputSchema,
    ToolErrorOutputSchema
  ])
});

export const AgentOutputSchema = z.object({
  reply: z.string(),
  toolCalls: z.array(ToolCallRecordSchema),
  action: ActionEnum,
  reason: z.string().min(1, 'reason is required')
});
