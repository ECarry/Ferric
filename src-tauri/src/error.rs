use std::collections::BTreeMap;
use std::fmt;

use serde::Serialize;

/// A structured, translatable error returned to the frontend.
///
/// `code` is an i18n key the UI resolves, `params` are its interpolation
/// values, and `detail` carries the raw technical message (library output,
/// exit codes, ...) which is never translated but helps with diagnostics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub params: BTreeMap<String, String>,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.to_string(),
            params: BTreeMap::new(),
            detail: None,
        }
    }

    /// Attach an interpolation parameter (e.g. `host`, `port`).
    pub fn param(mut self, key: &str, value: impl ToString) -> Self {
        self.params.insert(key.to_string(), value.to_string());
        self
    }

    /// Attach the untranslated technical cause.
    pub fn detail(mut self, detail: impl ToString) -> Self {
        self.detail = Some(detail.to_string());
        self
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{}: {}", self.code, detail),
            None => write!(f, "{}", self.code),
        }
    }
}

impl std::error::Error for AppError {}

/// Errors that were not given a code yet still need to reach the frontend.
impl From<String> for AppError {
    fn from(detail: String) -> Self {
        AppError::new("errUnknown").detail(detail)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(error: anyhow::Error) -> Self {
        // Preserve the structured error if one was raised further down.
        match error.downcast::<AppError>() {
            Ok(app_error) => app_error,
            Err(other) => AppError::new("errUnknown").detail(other),
        }
    }
}

impl From<russh::Error> for AppError {
    fn from(error: russh::Error) -> Self {
        AppError::new("errUnknown").detail(error)
    }
}
