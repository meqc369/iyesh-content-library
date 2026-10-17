const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

export type User = { id: string; name: string; avatarUrl?: string | null }

export function getAccessToken() { return uni.getStorageSync('accessToken') || '' }
export function getCurrentUser(): User | null { return uni.getStorageSync('currentUser') || null }

export function saveSession(accessToken: string, user: User) {
  uni.setStorageSync('accessToken', accessToken)
  uni.setStorageSync('currentUser', user)
}

export function clearSession() {
  uni.removeStorageSync('accessToken')
  uni.removeStorageSync('currentUser')
}

export function wechatLogin(): Promise<User> {
  return new Promise((resolve, reject) => {
    uni.login({ provider: 'weixin', success: (loginResult) => {
      uni.request({ url: `${API_BASE}/api/v1/auth/wechat-login`, method: 'POST', data: { code: loginResult.code }, success: (response) => {
        if (response.statusCode !== 200) return reject(new Error((response.data as any)?.message || '微信登录失败'))
        const data = response.data as any
        saveSession(data.accessToken, data.user)
        resolve(data.user)
      }, fail: reject })
    }, fail: reject })
  })
}
