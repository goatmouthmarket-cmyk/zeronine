import { DerivPrivateClient, type SessionInfo } from '../deriv/privateClient.ts';

type Entry = { client: DerivPrivateClient; connecting: Promise<SessionInfo> | null };

/** One private socket per Deriv account, shared only by sessions for that account. */
export class PlayerClients {
  private readonly entries = new Map<string, Entry>();
  private readonly balanceChanged: (accountId: string, balance: number) => void;

  constructor(balanceChanged: (accountId: string, balance: number) => void) {
    this.balanceChanged = balanceChanged;
  }

  async connect(accountId: string, token: string): Promise<DerivPrivateClient> {
    if (!accountId || !token) throw new Error('authorized account and token required');
    let entry = this.entries.get(accountId);
    if (!entry) {
      const client = new DerivPrivateClient({ persistBalance: balance => this.balanceChanged(accountId, balance) });
      entry = { client, connecting: null };
      this.entries.set(accountId, entry);
    }
    if (entry.client.isConnected && entry.client.connectedAccountId === accountId) return entry.client;
    if (!entry.connecting) {
      entry.connecting = entry.client.connect(token, accountId).finally(() => { entry!.connecting = null; });
    }
    const session = await entry.connecting;
    if (session.loginid !== accountId || entry.client.connectedAccountId !== accountId) {
      entry.client.disconnect();
      throw new Error('Deriv connected to a different account');
    }
    return entry.client;
  }

  disconnectAll(): void {
    for (const { client } of this.entries.values()) client.disconnect();
    this.entries.clear();
  }
}
