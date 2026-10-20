use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
#[derive(Debug)]
pub struct Error(pub StatusCode, pub &'static str, pub &'static str);
pub type Result<T> = std::result::Result<T, Error>;
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"code":self.1,"message":self.2}))).into_response()
    }
}
impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("database error: {e}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "存储操作失败",
        )
    }
}
pub fn unauthorized() -> Error {
    Error(StatusCode::UNAUTHORIZED, "unauthorized", "请重新登录")
}
pub fn forbidden() -> Error {
    Error(StatusCode::FORBIDDEN, "forbidden", "操作不被允许")
}
pub fn missing() -> Error {
    Error(StatusCode::NOT_FOUND, "not_found", "资源不存在或无权访问")
}
pub fn invalid() -> Error {
    Error(StatusCode::BAD_REQUEST, "invalid", "请检查输入内容")
}
pub fn conflict() -> Error {
    Error(
        StatusCode::CONFLICT,
        "conflict",
        "看板已更新，草稿已保留。请刷新版本后重试",
    )
}
