import { mount, unmount } from 'svelte'
import ConfirmDialog from './ConfirmDialog.svelte'

export interface ConfirmOptions {
  cancelText?: string
  confirmText?: string
  danger?: boolean
  message: string
  title?: string
}

export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options

  return new Promise((resolve) => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    let component: ReturnType<typeof mount>

    const handleClose = (result: boolean) => {
      resolve(result)
      if (component) {
        unmount(component)
      }
      if (target.parentNode) {
        target.parentNode.removeChild(target)
      }
    }

    component = mount(ConfirmDialog, {
      props: {
        ...opts,
        danger: opts.danger ?? true, // 大部分 confirm 都是由于删除操作
        onClose: handleClose,
        showCancel: true,
      },
      target,
    })
  })
}

export function alertDialog(message: string, title = '提示'): Promise<void> {
  return new Promise((resolve) => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    let component: ReturnType<typeof mount>

    const handleClose = () => {
      resolve()
      if (component) {
        unmount(component)
      }
      if (target.parentNode) {
        target.parentNode.removeChild(target)
      }
    }

    component = mount(ConfirmDialog, {
      props: {
        danger: false,
        message,
        onClose: handleClose,
        showCancel: false,
        title,
      },
      target,
    })
  })
}
