/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // ClipNest カスタムカラーパレット
                cn: {
                    dark: '#0d0d0d',
                    surface: '#1a1a1a',
                    'surface-hover': '#242424',
                    border: '#2d2d2d',
                    text: '#e5e5e5',
                    'text-muted': '#a3a3a3',
                    accent: '#6366f1',
                    'accent-hover': '#818cf8',
                    success: '#22c55e',
                    warning: '#f59e0b',
                    error: '#ef4444'
                }
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out'
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' }
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' }
                },
                scaleIn: {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' }
                }
            }
        }
    },
    plugins: []
}
