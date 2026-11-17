/* ============================================================
   Golden Touch · Pedidos · Formato enriquecido de chat
   Soporte estilo Slack, Telegram y WhatsApp:
   - Formatos: negrita (* o **), cursiva (_), tachado (~ o ~~),
     código (`...`), bloques de código (```...```), citas (>),
     viñetas (- o • o *) y listas numeradas (1.).
   - Menciones (@Nombre o @correo): insignia integrada con tono ámbar.
   - Referencias (#OC-..., #SP-..., #CS-..., #SS-...): chip interactivo
     con copia al portapapeles.
   - RESTRICCIÓN: Compras directas (#CD-...) y Servicios directos (#SD-...)
     NO se consideran referencias y se mantienen como texto regular.
   ============================================================ */
import React from 'react';
import { toast } from '@/shared/ui/Toast';
import { NOMBRES_CONOCIDOS_MENCIONES } from './chatMenciones';

export type TokenType =
  | 'text'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'url'
  | 'mention'
  | 'ref';

export interface InlineToken {
  type: TokenType;
  raw: string;
  content: string;
}

export interface ChatBlock {
  type: 'line' | 'bullet' | 'numbered' | 'quote' | 'codeblock';
  content: string;
  num?: string;
  indent?: number;
}

/**
 * Valida si un código es una referencia admitida (#OC, #SP, #CS, #SS).
 * Excluye explícitamente compras directas (#CD) y servicios directos (#SD).
 */
export function esReferenciaValida(codigo: string): boolean {
  if (!codigo) return false;
  const limpio = codigo.replace(/^#/, '').toUpperCase();
  // Excluir compras directas y servicios directos
  if (limpio.startsWith('CD-') || limpio.startsWith('SD-')) return false;
  return /^(?:OC|SP|CS|SS|GF)-[0-9A-Z-]+$/i.test(limpio);
}

/** Devuelve la etiqueta humana del tipo de referencia */
export function etiquetaTipoReferencia(codigo: string): string {
  const norm = codigo.replace(/^#/, '').toUpperCase();
  if (norm.startsWith('OC-')) return 'Orden de Compra';
  if (norm.startsWith('SP-')) return 'Solicitud de Pedido';
  if (norm.startsWith('CS-')) return 'Control de Servicio';
  if (norm.startsWith('SS-')) return 'Solicitud de Servicio';
  if (norm.startsWith('GF-')) return 'Gasto Fijo (Administración)';
  return 'Operación';
}

/**
 * Insignia de referencia (#OC, #SP, #CS, #SS).
 * Al hacer click, copia el código al portapapeles de forma amigable.
 */
export function ChatReferenciaBadge({ codigo, onClick }: { codigo: string; onClick?: (cod: string) => void }) {
  const tipo = etiquetaTipoReferencia(codigo);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick(codigo);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(`#${codigo}`);
      toast(`Código #${codigo} copiado al portapapeles`, 'success');
    }
  };

  return (
    <button
      type="button"
      className="chat-ref-badge"
      title={`${tipo} · Click para copiar #${codigo}`}
      onClick={handleCopy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        padding: '1px 6px',
        margin: '0 2px',
        borderRadius: '4px',
        fontSize: '0.82em',
        fontWeight: 600,
        fontFamily: 'var(--font-mono, monospace)',
        background: 'rgba(74, 168, 255, 0.12)',
        color: 'var(--info, #4aa8ff)',
        border: '1px solid rgba(74, 168, 255, 0.25)',
        cursor: 'pointer',
        verticalAlign: 'baseline',
        lineHeight: '1.4',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <span style={{ opacity: 0.65, fontWeight: 700 }}>#</span>
      <span>{codigo}</span>
    </button>
  );
}

/**
 * Insignia de mención (@Usuario).
 */
export function ChatMencionBadge({ nombre }: { nombre: string }) {
  return (
    <span
      className="chat-mention-badge"
      title={`Mención a ${nombre}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1px',
        padding: '1px 6px',
        margin: '0 2px',
        borderRadius: '4px',
        fontSize: '0.82em',
        fontWeight: 600,
        background: 'rgba(255, 138, 0, 0.12)',
        color: 'var(--primary, #ff8a00)',
        border: '1px solid rgba(255, 138, 0, 0.25)',
        verticalAlign: 'baseline',
        lineHeight: '1.4',
      }}
    >
      <span style={{ fontWeight: 800 }}>@</span>
      <span>{nombre}</span>
    </span>
  );
}

/**
 * Descompone el texto completo en bloques estructurados (líneas, listas, citas, código).
 */
export function parseChatBlocks(text: string): ChatBlock[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const blocks: ChatBlock[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Bloque de código multi-línea ```
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ type: 'codeblock', content: codeBlockLines.join('\n') });
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Cita estilo WhatsApp/Slack: > texto
    if (line.startsWith('>')) {
      const quoteText = line.replace(/^>\s?/, '');
      blocks.push({ type: 'quote', content: quoteText });
      continue;
    }

    // Viñetas: - , • o * (cuando * está al inicio de la línea seguido de espacio)
    const bulletMatch = line.match(/^(\s*)([-•]|\*(?=\s))\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({ type: 'bullet', indent: bulletMatch[1].length, content: bulletMatch[3] });
      continue;
    }

    // Listas numeradas: 1. , 2. 
    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numMatch) {
      blocks.push({ type: 'numbered', num: numMatch[2], indent: numMatch[1].length, content: numMatch[3] });
      continue;
    }

    // Línea normal o vacía
    blocks.push({ type: 'line', content: line });
  }

  if (inCodeBlock && codeBlockLines.length) {
    blocks.push({ type: 'codeblock', content: codeBlockLines.join('\n') });
  }

  return blocks;
}

/**
 * Tokeniza una línea de texto aplicando reglas de prioridad:
 * 1. Código monoespaciado (`...`)
 * 2. URLs (https?://...)
 * 3. Referencias admitidas (#OC-, #SP-, #CS-, #SS-)
 * 4. Menciones a usuarios (@...)
 * 5. Negrita (**...** o *...*)
 * 6. Cursiva (_..._)
 * 7. Tachado (~~...~~ o ~...~)
 */
export function tokenizeInline(text: string, knownNames: string[] = NOMBRES_CONOCIDOS_MENCIONES): InlineToken[] {
  if (!text) return [];

  const allNames = Array.from(new Set(knownNames)).sort((a, b) => b.length - a.length);
  const escapedNames = allNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  const patterns = [
    { type: 'code' as TokenType, regex: /^`([^`]+)`/ },
    { type: 'url' as TokenType, regex: /^(https?:\/\/[^\s<]+)/i },
    // Solo referencias permitidas; CD- y SD- no entran aquí
    { type: 'ref' as TokenType, regex: /^#((?:OC|SP|CS|SS|GF|oc|sp|cs|ss|gf)-[0-9A-Za-z-]+)\b/ },
    {
      type: 'mention' as TokenType,
      regex: new RegExp(
        `^@(?:(${escapedNames})|([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+)|([A-Za-zÁÉÍÓÚáéíóúñÑ0-9_]+))(?=[\\s,.:;!?)]|$)`,
        'i'
      ),
    },
    { type: 'bold' as TokenType, regex: /^(?:\*\*([^*]+)\*\*|\*([^*\n]+)\*)/ },
    { type: 'italic' as TokenType, regex: /^_([^_]+)_/ },
    { type: 'strike' as TokenType, regex: /^(?:~~([^~]+)~~|~([^~\n]+)~)/ },
  ];

  const triggers = ['`', 'h', '#', '@', '*', '_', '~'];
  const tokens: InlineToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // 1. Probar patrones en el inicio exacto (posición 0)
    let matchedAtStart = false;
    for (const p of patterns) {
      const m = p.regex.exec(remaining);
      if (m) {
        const full = m[0];
        const inner = m[1] || m[2] || m[3] || full;
        tokens.push({ type: p.type, raw: full, content: inner });
        remaining = remaining.slice(full.length);
        matchedAtStart = true;
        break;
      }
    }
    if (matchedAtStart) continue;

    // 2. Buscar el siguiente carácter disparador
    let nextIndex = remaining.length;
    let foundPattern = null;
    let foundMatch = null;

    for (let c = 1; c < remaining.length; c++) {
      if (triggers.includes(remaining[c])) {
        const sub = remaining.slice(c);
        for (const p of patterns) {
          const m = p.regex.exec(sub);
          if (m) {
            nextIndex = c;
            foundMatch = m;
            foundPattern = p;
            break;
          }
        }
        if (foundMatch) break;
      }
    }

    if (foundMatch && foundPattern) {
      // Texto plano previo
      tokens.push({ type: 'text', raw: remaining.slice(0, nextIndex), content: remaining.slice(0, nextIndex) });
      const full = foundMatch[0];
      const inner = foundMatch[1] || foundMatch[2] || foundMatch[3] || full;
      tokens.push({ type: foundPattern.type, raw: full, content: inner });
      remaining = remaining.slice(nextIndex + full.length);
    } else {
      tokens.push({ type: 'text', raw: remaining, content: remaining });
      remaining = '';
    }
  }

  return tokens;
}

/**
 * Renderiza recursivamente tokens en React Nodes seguros.
 */
function renderInlineTokens(tokens: InlineToken[], onRefClick?: (codigo: string) => void): React.ReactNode[] {
  return tokens.map((token, idx) => {
    const key = `tok-${idx}-${token.type}`;
    switch (token.type) {
      case 'text':
        return token.content;
      case 'bold':
        return <strong key={key} style={{ fontWeight: 700 }}>{renderInlineTokens(tokenizeInline(token.content), onRefClick)}</strong>;
      case 'italic':
        return <em key={key}>{renderInlineTokens(tokenizeInline(token.content), onRefClick)}</em>;
      case 'strike':
        return <del key={key} style={{ opacity: 0.75 }}>{renderInlineTokens(tokenizeInline(token.content), onRefClick)}</del>;
      case 'code':
        return (
          <code
            key={key}
            style={{
              background: 'var(--bg-2, #262a31)',
              border: '1px solid var(--border, #333944)',
              padding: '1px 5px',
              borderRadius: 4,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.85em',
              color: 'var(--warning, #f5b133)',
            }}
          >
            {token.content}
          </code>
        );
      case 'url':
        return (
          <a
            key={key}
            href={token.raw}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--info, #4aa8ff)', textDecoration: 'underline', wordBreak: 'break-all' }}
          >
            {token.raw}
          </a>
        );
      case 'mention':
        return <ChatMencionBadge key={key} nombre={token.content} />;
      case 'ref':
        return <ChatReferenciaBadge key={key} codigo={token.content} onClick={onRefClick} />;
      default:
        return token.content;
    }
  });
}

/**
 * Componente principal que renderiza el contenido enriquecido de un mensaje de chat.
 */
export function ChatMensajeContenido({
  mensaje,
  onReferenciaClick,
}: {
  mensaje: string;
  onReferenciaClick?: (codigo: string) => void;
}) {
  const blocks = parseChatBlocks(mensaje);

  return (
    <div style={{ wordBreak: 'break-word', lineHeight: '1.45' }}>
      {blocks.map((b, idx) => {
        const key = `blk-${idx}-${b.type}`;
        if (b.type === 'codeblock') {
          return (
            <pre
              key={key}
              style={{
                margin: '.3rem 0',
                padding: '.45rem .65rem',
                borderRadius: '6px',
                background: 'var(--bg-0, #1c1f24)',
                fontSize: '.78rem',
                fontFamily: 'var(--font-mono, monospace)',
                overflowX: 'auto',
                border: '1px solid var(--border, #333944)',
                color: 'var(--text)',
              }}
            >
              <code>{b.content}</code>
            </pre>
          );
        }
        if (b.type === 'quote') {
          return (
            <div
              key={key}
              style={{
                borderLeft: '3px solid var(--primary, #ff8a00)',
                paddingLeft: '8px',
                margin: '.25rem 0',
                color: 'var(--text-muted, #9aa6b5)',
              }}
            >
              {renderInlineTokens(tokenizeInline(b.content), onReferenciaClick)}
            </div>
          );
        }
        if (b.type === 'bullet') {
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '6px',
                marginLeft: `${Math.max(4, b.indent ? b.indent * 6 : 4)}px`,
                margin: '.12rem 0',
              }}
            >
              <span style={{ color: 'var(--primary, #ff8a00)', fontSize: '.85em' }}>•</span>
              <span style={{ flex: 1 }}>{renderInlineTokens(tokenizeInline(b.content), onReferenciaClick)}</span>
            </div>
          );
        }
        if (b.type === 'numbered') {
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '6px',
                marginLeft: `${Math.max(4, b.indent ? b.indent * 6 : 4)}px`,
                margin: '.12rem 0',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--text-muted)', fontSize: '.82em', minWidth: '16px' }}>{b.num}.</span>
              <span style={{ flex: 1 }}>{renderInlineTokens(tokenizeInline(b.content), onReferenciaClick)}</span>
            </div>
          );
        }
        // Línea estándar
        if (!b.content.trim()) {
          return <div key={key} style={{ height: '.35rem' }} />;
        }
        return (
          <div key={key} style={{ minHeight: '1.2em' }}>
            {renderInlineTokens(tokenizeInline(b.content), onReferenciaClick)}
          </div>
        );
      })}
    </div>
  );
}
