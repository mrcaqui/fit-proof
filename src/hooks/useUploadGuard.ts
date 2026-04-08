import { useEffect } from 'react'

/**
 * アップロード中のページ離脱を防止するフック
 * - beforeunload リスナーを登録（デスクトップ向け。iOS Safari では効かないが害もない）
 */
export function useUploadGuard(isUploading: boolean) {
  useEffect(() => {
    if (!isUploading) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [isUploading])
}
