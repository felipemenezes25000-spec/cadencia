import { createHash } from 'node:crypto';
import type { ActionDef } from './actions';

export interface ActionRow {
  key: string;
  description: string;
  roles: string[];
  requiresMfa: boolean;
}

export function catalogRows(actions: readonly ActionDef[]): ActionRow[] {
  return actions
    .map((a) => ({
      key: a.key,
      description: a.description,
      roles: [...a.roles].sort(),
      requiresMfa: a.requiresMfa === true,
    }))
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

export function catalogChecksum(rows: readonly ActionRow[]): string {
  const canonical = rows
    .map((r) => `${r.key}|${r.description}|${r.roles.join(',')}|${r.requiresMfa}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
