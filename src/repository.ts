import { readFile, writeFile } from 'node:fs/promises';
import { CustomerRecord, GetBalanceOutput, MarkOptOutOutput, ToolErrorOutput } from './types.js';

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
}
