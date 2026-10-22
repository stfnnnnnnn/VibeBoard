import type { CSSProperties } from 'react';

export const FIELD_LABEL: CSSProperties = { display: 'block', marginBottom: 6, font: '600 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text)' };
export const FIELD_INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '8px 10px',
  font: '500 var(--wb-fs-14) var(--wb-font-ui)', color: 'var(--wb-text)',
  background: 'var(--wb-surface)', border: '1px solid var(--wb-border)', borderRadius: 'var(--wb-r-md)',
};
export const FIELD_ERROR: CSSProperties = { marginTop: 4, font: '600 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-danger)' };
export const FIELD_HINT: CSSProperties = { marginTop: 4, font: '500 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)' };
export const FIELD_GROUP: CSSProperties = { display: 'grid', gap: 14 };
