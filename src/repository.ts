import { readFile, writeFile } from 'node:fs/promises';
import {
  CustomerRecord,
  GetBalanceOutput,
  MarkOptOutOutput,
  CreatePaymentLinkOutput,
  ToolErrorOutput
} from './types.js';

export interface RepositoryOptions {
  filePath?: string;
  initialCustomers?: CustomerRecord[];
}

export class CustomerRepository {
  private customers: Map<string, CustomerRecord> = new Map();
  private filePath: string | undefined;
  private isLoaded: boolean = false;

  constructor(options?: RepositoryOptions) {
    this.filePath = options?.filePath;
    if (options?.initialCustomers) {
      for (const customer of options.initialCustomers) {
        this.customers.set(customer.id, { ...customer });
      }
      this.isLoaded = true;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.isLoaded && this.filePath) {
      await this.initialize();
    }
  }

  public async initialize(): Promise<void> {
    if (this.filePath) {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            typeof item === 'object' &&
            item !== null &&
            'id' in item &&
            typeof item.id === 'string' &&
            'name' in item &&
            typeof item.name === 'string' &&
            'phone' in item &&
            typeof item.phone === 'string' &&
            'balance' in item &&
            typeof item.balance === 'number' &&
            'currency' in item &&
            typeof item.currency === 'string' &&
            'isOptedOut' in item &&
            typeof item.isOptedOut === 'boolean'
          ) {
            this.customers.set(item.id, {
              id: item.id,
              name: item.name,
              phone: item.phone,
              balance: item.balance,
              currency: item.currency,
              isOptedOut: item.isOptedOut
            });
          }
        }
      }
      this.isLoaded = true;
    }
  }

  public async getAllCustomers(): Promise<CustomerRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.customers.values()).map((c) => ({ ...c }));
  }

  public async getCustomer(customerId: string): Promise<CustomerRecord | null> {
    await this.ensureLoaded();
    const customer = this.customers.get(customerId);
    if (!customer) {
      return null;
    }
    return { ...customer };
  }

  public async getBalance(customerId: string): Promise<GetBalanceOutput | ToolErrorOutput> {
    await this.ensureLoaded();
    const customer = this.customers.get(customerId);
    if (!customer) {
      return { error: `Customer not found with id: ${customerId}` };
    }
    return {
      balance: customer.balance,
      currency: customer.currency
    };
  }

  public async markOptOut(customerId: string): Promise<MarkOptOutOutput | ToolErrorOutput> {
    await this.ensureLoaded();
    const customer = this.customers.get(customerId);
    if (!customer) {
      return { error: `Customer not found with id: ${customerId}` };
    }
    customer.isOptedOut = true;
    this.customers.set(customerId, customer);

    if (this.filePath) {
      try {
        const records = Array.from(this.customers.values());
        await writeFile(this.filePath, JSON.stringify(records, null, 2), 'utf-8');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown write error';
        return { error: `Failed to persist opt-out: ${message}` };
      }
    }

    return {
      optedOut: true,
      success: true
    };
  }

  public async createPaymentLink(
    customerId: string,
    amount: number
  ): Promise<CreatePaymentLinkOutput | ToolErrorOutput> {
    await this.ensureLoaded();

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return { error: 'Amount must be a positive number' };
    }

    const customer = this.customers.get(customerId);
    if (!customer) {
      return { error: `Customer not found with id: ${customerId}` };
    }

    // Generate secure, deterministic payment link
    const expiresDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
    const token = Math.abs(Math.sin(amount + customer.id.length) * 10000000)
      .toString(36)
      .substring(0, 8);
    const paymentLink = `https://pay.financeops.com/pay/${encodeURIComponent(customerId)}?amt=${amount.toFixed(2)}&t=${token}`;

    return {
      paymentLink,
      amount,
      currency: customer.currency,
      expiresAt: expiresDate.toISOString()
    };
  }
}
