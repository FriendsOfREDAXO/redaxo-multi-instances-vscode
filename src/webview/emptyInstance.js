// Empty Instance JavaScript
(function() {
    const vscode = acquireVsCodeApi();

    // DOM Elements
    const form = document.getElementById('emptyInstanceForm');
    const instanceNameInput = document.getElementById('instanceName');
    const projectPathInput = document.getElementById('projectPath');
    const phpVersionSelect = document.getElementById('phpVersion');
    const mariadbVersionSelect = document.getElementById('mariadbVersion');
    const enableXdebugCheckbox = document.getElementById('enableXdebug');
    const openInNewWindowCheckbox = document.getElementById('openInNewWindow');
    const selectPathButton = document.getElementById('selectPath');
    const createButton = document.getElementById('createBtn');

    // State management
    let isCreating = false;

    // Event Listeners
    form.addEventListener('submit', handleFormSubmit);
    selectPathButton.addEventListener('click', handleSelectPath);
    instanceNameInput.addEventListener('input', updateProjectPath);
    instanceNameInput.addEventListener('blur', validateInstanceName);

    // Message listener für VS Code
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
            case 'projectPathSelected':
                projectPathInput.value = message.path;
                validateForm();
                break;
                
            case 'creationStarted':
                setCreatingState(true);
                break;
                
            case 'creationCompleted':
                setCreatingState(false);
                showSuccessMessage('Empty Instance erfolgreich erstellt!');
                resetForm();
                break;
                
            case 'creationError':
                setCreatingState(false);
                showErrorMessage(message.error || 'Fehler beim Erstellen der Instance');
                break;
        }
    });

    // Form Submit Handler
    function handleFormSubmit(event) {
        event.preventDefault();
        
        if (isCreating) {
            return;
        }
        
        if (!validateForm()) {
            showErrorMessage('Bitte fülle alle erforderlichen Felder aus.');
            return;
        }

        const config = {
            instanceName: instanceNameInput.value.trim(),
            projectPath: projectPathInput.value,
            phpVersion: phpVersionSelect.value,
            mariadbVersion: mariadbVersionSelect.value,
            enableXdebug: enableXdebugCheckbox.checked,
            openInNewWindow: openInNewWindowCheckbox.checked
        };

        setCreatingState(true);
        
        vscode.postMessage({
            type: 'createEmptyInstance',
            config: config
        });
    }

    // Path Selection Handler
    function handleSelectPath() {
        vscode.postMessage({
            type: 'selectProjectPath'
        });
    }

    // Auto-update project path based on instance name
    function updateProjectPath() {
        const instanceName = instanceNameInput.value.trim();
        
        if (instanceName && !projectPathInput.value) {
            // Generiere einen Vorschlag für den Projektpfad
            const homeDir = require('os').homedir?.() || '~';
            const suggestedPath = `${homeDir}/Documents/projects/${instanceName}`;
            // Für jetzt lassen wir es leer, da wir keinen Zugriff auf das Dateisystem haben
        }
        
        validateForm();
    }

    // Instance Name Validation
    function validateInstanceName() {
        const instanceName = instanceNameInput.value.trim();
        const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
        
        if (!instanceName) {
            setFieldError(instanceNameInput, 'Instanz Name ist erforderlich');
            return false;
        }
        
        if (!namePattern.test(instanceName)) {
            setFieldError(instanceNameInput, 'Nur Buchstaben, Zahlen, _ und - erlaubt. Muss mit Buchstabe oder Zahl beginnen.');
            return false;
        }
        
        if (instanceName.length < 2) {
            setFieldError(instanceNameInput, 'Mindestens 2 Zeichen erforderlich');
            return false;
        }
        
        if (instanceName.length > 50) {
            setFieldError(instanceNameInput, 'Maximal 50 Zeichen erlaubt');
            return false;
        }
        
        clearFieldError(instanceNameInput);
        return true;
    }

    // Form Validation
    function validateForm() {
        const isNameValid = validateInstanceName();
        const isPathValid = !!projectPathInput.value.trim();
        const isPhpValid = !!phpVersionSelect.value;
        const isMariaDbValid = !!mariadbVersionSelect.value;
        
        const isFormValid = isNameValid && isPathValid && isPhpValid && isMariaDbValid;
        
        createButton.disabled = !isFormValid;
        
        return isFormValid;
    }

    // UI State Management
    function setCreatingState(creating) {
        isCreating = creating;
        
        if (creating) {
            createButton.textContent = 'Erstelle Instance...';
            createButton.classList.add('loading');
            createButton.disabled = true;
            
            // Disable form inputs
            form.querySelectorAll('input, select, button').forEach(element => {
                if (element !== createButton) {
                    element.disabled = true;
                }
            });
        } else {
            createButton.textContent = '🚀 Empty Instance erstellen';
            createButton.classList.remove('loading');
            
            // Re-enable form inputs
            form.querySelectorAll('input, select, button').forEach(element => {
                element.disabled = false;
            });
            
            validateForm();
        }
    }

    // Error Handling
    function setFieldError(field, message) {
        clearFieldError(field);
        
        field.classList.add('error');
        const errorElement = document.createElement('small');
        errorElement.className = 'error-message';
        errorElement.textContent = message;
        errorElement.style.color = 'var(--vscode-errorForeground)';
        
        field.parentNode.appendChild(errorElement);
    }

    function clearFieldError(field) {
        field.classList.remove('error');
        const errorMessage = field.parentNode.querySelector('.error-message');
        if (errorMessage) {
            errorMessage.remove();
        }
    }

    // Message Display
    function showSuccessMessage(message) {
        showMessage(message, 'success');
    }

    function showErrorMessage(message) {
        showMessage(message, 'error');
    }

    function showMessage(message, type) {
        // Remove existing messages
        const existingMessages = document.querySelectorAll('.message');
        existingMessages.forEach(msg => msg.remove());
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = message;
        
        const container = document.querySelector('.container');
        container.insertBefore(messageElement, container.firstChild);
        
        // Auto-remove success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.remove();
                }
            }, 5000);
        }
    }

    // Form Reset
    function resetForm() {
        form.reset();
        projectPathInput.value = '';
        phpVersionSelect.value = '8.3';
        mariadbVersionSelect.value = '11.2';
        enableXdebugCheckbox.checked = false;
        openInNewWindowCheckbox.checked = true;
        
        // Clear any error states
        form.querySelectorAll('input, select').forEach(field => {
            clearFieldError(field);
        });
        
        validateForm();
    }

    // Auto-generate suggested instance name from current time
    function generateSuggestedName() {
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        return `empty-instance-${timestamp}`;
    }

    // Initialize form
    function initializeForm() {
        // Set default values
        phpVersionSelect.value = '8.3';
        mariadbVersionSelect.value = '11.2';
        enableXdebugCheckbox.checked = false;
        openInNewWindowCheckbox.checked = true;
        
        // Focus on instance name input
        setTimeout(() => {
            instanceNameInput.focus();
        }, 100);
        
        validateForm();
    }

    // Helper Functions
    function sanitizeInstanceName(name) {
        return name
            .toLowerCase()
            .replace(/[^a-zA-Z0-9_-]/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // Add input event listeners for live validation
    instanceNameInput.addEventListener('input', () => {
        clearFieldError(instanceNameInput);
    });

    projectPathInput.addEventListener('change', validateForm);
    phpVersionSelect.addEventListener('change', validateForm);
    mariadbVersionSelect.addEventListener('change', validateForm);

    // Initialize on load
    document.addEventListener('DOMContentLoaded', initializeForm);

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        // Escape key to cancel creation (if implementing cancel functionality)
        if (event.key === 'Escape' && isCreating) {
            // Could implement cancel functionality here
        }
        
        // Enter key in instance name field to focus next field
        if (event.key === 'Enter' && event.target === instanceNameInput) {
            event.preventDefault();
            selectPathButton.focus();
        }
    });

    // Auto-save form state (optional)
    function saveFormState() {
        const state = {
            instanceName: instanceNameInput.value,
            phpVersion: phpVersionSelect.value,
            mariadbVersion: mariadbVersionSelect.value,
            enableXdebug: enableXdebugCheckbox.checked,
            openInNewWindow: openInNewWindowCheckbox.checked
        };
        
        vscode.setState(state);
    }

    function restoreFormState() {
        const state = vscode.getState();
        if (state) {
            instanceNameInput.value = state.instanceName || '';
            phpVersionSelect.value = state.phpVersion || '8.3';
            mariadbVersionSelect.value = state.mariadbVersion || '11.2';
            enableXdebugCheckbox.checked = state.enableXdebug || false;
            openInNewWindowCheckbox.checked = state.openInNewWindow !== undefined ? state.openInNewWindow : true;
            
            validateForm();
        }
    }

    // Save state on form changes
    [instanceNameInput, phpVersionSelect, mariadbVersionSelect, enableXdebugCheckbox, openInNewWindowCheckbox].forEach(element => {
        element.addEventListener('change', saveFormState);
    });

    // Restore state on load
    window.addEventListener('load', restoreFormState);

})();
