/**
 * ゲーミフィケーション通知ポップアップコンポーネント
 * CSS animationを使用したアニメーション演出
 */

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface GamificationPopupProps {
    type: 'shield_consumed' | 'revival_success' | 'perfect_week'
    message: string
    count?: number
    onClose: () => void
    autoCloseMs?: number
}

export function GamificationPopup({
    type,
    message,
    count,
    onClose,
    autoCloseMs = 4000
}: GamificationPopupProps) {
    const [isVisible, setIsVisible] = useState(false)
    const [isClosing, setIsClosing] = useState(false)

    useEffect(() => {
        // 表示アニメーション開始
        const showTimer = setTimeout(() => setIsVisible(true), 50)

        // 自動クローズ
        const closeTimer = setTimeout(() => {
            handleClose()
        }, autoCloseMs)

        return () => {
            clearTimeout(showTimer)
            clearTimeout(closeTimer)
        }
    }, [autoCloseMs])

    const handleClose = () => {
        setIsClosing(true)
        setTimeout(() => {
            onClose()
        }, 300)
    }

    // アイコンと色の設定
    const config = {
        shield_consumed: {
            icon: '/assets/shield.png',
            bgColor: 'bg-blue-500/90',
            borderColor: 'border-blue-300'
        },
        revival_success: {
            icon: '/assets/revival_badge.png',
            bgColor: 'bg-orange-500/90',
            borderColor: 'border-orange-300'
        },
        perfect_week: {
            icon: '/assets/perfect_crown.png',
            bgColor: 'bg-yellow-500/90',
            borderColor: 'border-yellow-300'
        }
    }[type]

    return (
        <div
            className={`
                fixed inset-0 z-50 flex items-center justify-center pointer-events-none
                transition-opacity duration-300
                ${isVisible && !isClosing ? 'opacity-100' : 'opacity-0'}
            `}
        >
            {/* 背景オーバーレイ */}
            <div
                className={`
                    absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto
                    transition-opacity duration-300
                    ${isVisible && !isClosing ? 'opacity-100' : 'opacity-0'}
                `}
                onClick={handleClose}
            />

            {/* ポップアップカード */}
            <div
                className={`
                    relative pointer-events-auto
                    ${config.bgColor} ${config.borderColor}
                    border-2 rounded-2xl shadow-2xl
                    p-6 max-w-sm mx-4
                    transform transition-all duration-300 ease-out
                    ${isVisible && !isClosing
                        ? 'scale-100 translate-y-0'
                        : 'scale-75 translate-y-8'}
                `}
            >
                {/* 閉じるボタン */}
                <button
                    onClick={handleClose}
                    className="absolute top-2 right-2 text-white/70 hover:text-white transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* アイコン */}
                <div className="flex justify-center mb-4">
                    <img
                        src={config.icon}
                        alt=""
                        className={`
                            w-20 h-20 object-contain drop-shadow-lg
                            ${type === 'revival_success' ? 'animate-bounce-slow' : ''}
                            ${type === 'perfect_week' ? 'animate-pulse' : ''}
                        `}
                    />
                </div>

                {/* メッセージ */}
                <p className="text-center text-white font-bold text-lg leading-relaxed">
                    {message}
                </p>

                {/* カウント表示 */}
                {count !== undefined && (
                    <p className="text-center text-white/80 text-sm mt-2">
                        ×{count}
                    </p>
                )}
            </div>
        </div>
    )
}

/**
 * 複数の通知を管理するコンテナ
 */
interface GamificationNotificationsProps {
    notifications: Array<{
        type: 'shield_consumed' | 'revival_success' | 'perfect_week'
        message: string
        count?: number
    }>
    onClear: (index: number) => void
}

export function GamificationNotifications({
    notifications,
    onClear
}: GamificationNotificationsProps) {
    if (notifications.length === 0) return null

    // 最初の通知のみ表示（順番に処理）
    const notification = notifications[0]

    return (
        <GamificationPopup
            type={notification.type}
            message={notification.message}
            count={notification.count}
            onClose={() => onClear(0)}
        />
    )
}
