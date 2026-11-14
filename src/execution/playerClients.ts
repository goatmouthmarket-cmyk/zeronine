import { DerivPrivateClient, type SessionInfo } from '../deriv/privateClient.ts';

type Entry = { client: DerivPrivateClient; connecting: Promise<SessionInfo> | null; session: SessionInfo | null };

/** One private socket per Deriv account, shared only by sessions for that account. */
export class PlayerClients {
  private readonly entries = new Map<string, Entry>();
  private readonly balanceChanged: (accountId: string, balance: number) => void;

  constructor(balanceChanged: (accountId: string, balance: number) => void) {
    this.balanceChanged = balanceChanged;
  }

  async connectWithSession(accountId: string, token: string): Promise<{ client: DerivPrivateClient; session: SessionInfo }> {
    if (!accountId || !token) throw new Error('authorized account and token required');
    let entry = this.entries.get(accountId);
    if (!entry) {
      const client = new DerivPrivateClient({ persistBalance: balance => {
        if (entry?.session) entry.session = { ...entry.session, balance };
        this.balanceChanged(accountId, balance);
      } });
      entry = { client, connecting: null, session: null };
      this.entries.set(accountId, entry);
    }
    if (entry.client.isConnected && entry.client.connectedAccountId === accountId) {
      if (!entry.session) throw new Error('Deriv account session is unavailable');
      return { client: entry.client, session: entry.session };
    }
    if (!entry.connecting) {
      entry.connecting = entry.client.connect(token, accountId).finally(() => { entry!.connecting = null; });
    }
    const session = await entry.connecting;
    entry.session = session;
    if (session.loginid !== accountId || entry.client.connectedAccountId !== accountId) {
      entry.client.disconnect();
      entry.session = null;
      throw new Error('Deriv connected to a different account');
    }
    return { client: entry.client, session };
  }

  async connect(accountId: string, token: string): Promise<DerivPrivateClient> {
    return (await this.connectWithSession(accountId, token)).client;
  }

  disconnectAll(): void {
    for (const { client } of this.entries.values()) client.disconnect();
    this.entries.clear();
  }
}
