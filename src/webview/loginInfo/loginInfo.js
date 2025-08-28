/**
 * Modern Login Info Webview JavaScript
 * Handles interactions, animations, and clipboard operations
 */

class LoginInfoWebview {
    constructor() {
        this.vscode = acquireVsCodeApi();
        this.copyToast = document.getElementById('copy-toast');
        this.init();
    }

    init() {
        this.initTabSystem();
        this.initCopyButtons();
        this.initVisibilityToggles();
        this.initThemeDetection();
        this.startAnimations();
    }

    /**
     * Initialize tab switching system
     */
    initTabSystem() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.dataset.tab;
                
                // Remove active class from all buttons and contents
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                // Add active class to clicked button and corresponding content
                button.classList.add('active');
                document.getElementById(`tab-${targetTab}`).classList.add('active');
                
                // Micro animation feedback
                this.addButtonFeedback(button);
            });
        });
    }

    /**
     * Initialize copy to clipboard functionality
     */
    initCopyButtons() {
        const copyButtons = document.querySelectorAll('.copy-btn');
        
        copyButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                
                const textToCopy = button.dataset.copy;
                const feedbackId = button.dataset.feedback;
                
                try {
                    await this.copyToClipboard(textToCopy);
                    this.showCopySuccess(button, feedbackId);
                } catch (error) {
                    console.error('Copy failed:', error);
                    this.showCopyError(button);
                }
            });
        });
    }

    /**
     * Initialize password visibility toggles
     */
    initVisibilityToggles() {
        const toggleButtons = document.querySelectorAll('.toggle-visibility');
        
        toggleButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                
                const targetClass = button.dataset.target;
                const passwordField = button.closest('.credential-field').querySelector(`.${targetClass}`);
                const icon = button.querySelector('.visibility-icon');
                
                if (passwordField.classList.contains('hidden')) {
                    passwordField.classList.remove('hidden');
                    icon.textContent = '👁️';
                } else {
                    passwordField.classList.add('hidden');
                    icon.textContent = '🙈';
                }
                
                this.addButtonFeedback(button);
            });
        });
    }

    /**
     * Detect VS Code theme and apply appropriate styles
     */
    initThemeDetection() {
        const body = document.body;
        const theme = body.dataset.vscodeThemeKind || 'vscode-dark';
        
        // Apply theme-specific adjustments
        if (theme === 'vscode-light') {
            document.documentElement.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.8)');
            document.documentElement.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.1)');
        }
    }

    /**
     * Start entrance animations
     */
    startAnimations() {
        const animatedElements = document.querySelectorAll('.animate-in');
        
        animatedElements.forEach((element, index) => {
            setTimeout(() => {
                element.style.animationDelay = `${index * 0.1}s`;
            }, index * 50);
        });

        // Add hover effects to glass cards
        this.initGlassEffects();
    }

    /**
     * Initialize glass morphism hover effects
     */
    initGlassEffects() {
        const glassCards = document.querySelectorAll('.glass-card');
        
        glassCards.forEach(card => {
            card.addEventListener('mouseenter', (e) => {
                this.addGlassGlow(card, e);
            });
            
            card.addEventListener('mousemove', (e) => {
                this.updateGlassGlow(card, e);
            });
            
            card.addEventListener('mouseleave', () => {
                this.removeGlassGlow(card);
            });
        });
    }

    /**
     * Add glass glow effect on hover
     */
    addGlassGlow(card, event) {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
        
        if (!card.querySelector('.glass-glow')) {
            const glow = document.createElement('div');
            glow.className = 'glass-glow';
            glow.style.cssText = `
                position: absolute;
                width: 100px;
                height: 100px;
                background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
                border-radius: 50%;
                pointer-events: none;
                transform: translate(-50%, -50%);
                left: var(--mouse-x);
                top: var(--mouse-y);
                transition: opacity 0.3s ease;
            `;
            card.appendChild(glow);
        }
    }

    /**
     * Update glass glow position
     */
    updateGlassGlow(card, event) {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const glow = card.querySelector('.glass-glow');
        if (glow) {
            glow.style.left = `${x}px`;
            glow.style.top = `${y}px`;
        }
    }

    /**
     * Remove glass glow effect
     */
    removeGlassGlow(card) {
        const glow = card.querySelector('.glass-glow');
        if (glow) {
            glow.style.opacity = '0';
            setTimeout(() => {
                glow.remove();
            }, 300);
        }
    }

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            // Fallback for older browsers or non-secure contexts
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                document.execCommand('copy');
            } finally {
                textArea.remove();
            }
        }
    }

    /**
     * Show copy success feedback
     */
    showCopySuccess(button, feedbackId) {
        // Button success animation
        button.classList.add('success');
        const originalHTML = button.innerHTML;
        button.innerHTML = '<span class="copy-icon">✅</span>';
        
        setTimeout(() => {
            button.classList.remove('success');
            button.innerHTML = originalHTML;
        }, 1000);

        // Global toast notification
        this.showCopyToast('Copied to clipboard!');
        
        // Haptic feedback (if supported)
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    }

    /**
     * Show copy error feedback
     */
    showCopyError(button) {
        button.style.background = 'var(--error-color)';
        button.style.color = 'white';
        
        setTimeout(() => {
            button.style.background = '';
            button.style.color = '';
        }, 1000);
        
        this.showCopyToast('Failed to copy!', true);
    }

    /**
     * Show copy toast notification
     */
    showCopyToast(message, isError = false) {
        const toast = this.copyToast;
        const messageElement = toast.querySelector('.toast-message');
        const iconElement = toast.querySelector('.toast-icon');
        
        messageElement.textContent = message;
        iconElement.textContent = isError ? '❌' : '✅';
        
        if (isError) {
            toast.style.background = 'var(--error-color)';
        } else {
            toast.style.background = 'var(--success-color)';
        }
        
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    /**
     * Add button feedback animation
     */
    addButtonFeedback(button) {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = '';
        }, 150);
    }

    /**
     * Initialize URL click tracking (optional analytics)
     */
    initUrlTracking() {
        const urlLinks = document.querySelectorAll('.url-link');
        
        urlLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                const url = link.href;
                console.log('Opening URL:', url);
                
                // Optional: Send analytics to VS Code extension
                this.vscode.postMessage({
                    command: 'urlClicked',
                    url: url
                });
            });
        });
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LoginInfoWebview();
});

// Handle VS Code theme changes
window.addEventListener('message', (event) => {
    const message = event.data;
    
    switch (message.command) {
        case 'themeChanged':
            document.body.dataset.vscodeThemeKind = message.theme;
            break;
    }
});

// Smooth scroll behavior for internal links
document.addEventListener('click', (e) => {
    if (e.target.matches('a[href^="#"]')) {
        e.preventDefault();
        const targetId = e.target.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);
        
        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }
});

// Performance optimization: Debounced resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Recalculate any layout-dependent features
        const container = document.querySelector('.container');
        if (container && window.innerWidth < 768) {
            container.classList.add('mobile');
        } else {
            container.classList.remove('mobile');
        }
    }, 250);
});

// Keyboard accessibility
document.addEventListener('keydown', (e) => {
    // Copy on Ctrl+C / Cmd+C when focusing on credential fields
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const focusedElement = document.activeElement;
        const credentialField = focusedElement.closest('.credential-field');
        
        if (credentialField) {
            const copyButton = credentialField.querySelector('.copy-btn');
            if (copyButton) {
                copyButton.click();
                e.preventDefault();
            }
        }
    }
});

// Export for potential testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LoginInfoWebview;
}
