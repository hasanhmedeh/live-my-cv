// The office's own dialogs, in place of the browser's confirm() and prompt(): styled like the rest of
// the office, with the action spelled out on its button. Built on <dialog>, so the focus stays inside
// while it's open, Esc cancels, and screen readers announce it.
import { esc } from './util';

export interface AskOptions {
  /** An emoji above the title. */
  icon?: string;
  title: string;
  /** Plain text. */
  body: string;
  /** What the button does, e.g. "Close the park". */
  confirm: string;
  /** A red button, for what can't be undone. The focus then starts on Cancel. */
  danger?: boolean;
  /** The button only wakes up once this is typed exactly (deletions). */
  typeToConfirm?: string;
}

/** Asks before doing something big. Resolves to true if staff confirmed, false if they cancelled (Cancel, Esc, or a click outside). */
export function ask(o: AskOptions): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'office-dialog';
  dialog.setAttribute('aria-labelledby', 'office-dialog-title');
  dialog.setAttribute('aria-describedby', 'office-dialog-body');
  dialog.innerHTML = `<form method="dialog">
      ${o.icon ? `<p class="office-dialog-icon" aria-hidden="true">${esc(o.icon)}</p>` : ''}
      <h2 id="office-dialog-title">${esc(o.title)}</h2>
      <p id="office-dialog-body">${esc(o.body)}</p>
      ${
        o.typeToConfirm
          ? `<label>Type <strong>${esc(o.typeToConfirm)}</strong> to confirm<input name="typed" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>`
          : ''
      }
      <div class="office-dialog-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn ${o.danger ? 'btn-danger-solid' : 'btn-primary'}" value="ok" ${o.typeToConfirm ? 'disabled' : ''}>${esc(o.confirm)}</button>
      </div>
    </form>`;

  const confirm = dialog.querySelector<HTMLButtonElement>('[value="ok"]')!;
  const typed = dialog.querySelector<HTMLInputElement>('[name="typed"]');
  // a disabled default button also stops Enter from submitting a mismatch
  typed?.addEventListener('input', () => (confirm.disabled = typed.value.trim() !== o.typeToConfirm));
  dialog.querySelector('[data-cancel]')!.addEventListener('click', () => dialog.close('cancel'));
  // a click on the backdrop (the dialog itself, outside its form) cancels
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close('cancel'));

  document.body.append(dialog);
  dialog.showModal();
  (typed ?? (o.danger ? dialog.querySelector<HTMLButtonElement>('[data-cancel]') : confirm))?.focus();

  return new Promise((resolve) =>
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    }),
  );
}
