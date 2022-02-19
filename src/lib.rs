#![feature(once_cell)]
#![allow(clippy::unused_unit)]

mod triangulate;
mod webgl;

use std::lazy::SyncLazy;
use std::sync::Mutex;
use triangulate::gen_mesh;
use wasm_bindgen::prelude::*;
use webgl::WebglState;

// wasm is single threaded for now, so it should be okay to fake send + sync
unsafe impl Send for WebglState {}
unsafe impl Sync for WebglState {}
static STATE: SyncLazy<Mutex<WebglState>> =
    SyncLazy::new(|| Mutex::new(WebglState::init("canvas").unwrap_or_else(|e| panic!("{}", e))));

#[derive(Debug, Clone, Copy)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}
pub type Line = [Point; 2];
pub type Triangle = [Point; 3]; // should always have ccw winding

#[derive(Debug, Clone, Copy)]
pub enum Primitive {
    Point(Point),
    Line(Line),
    Triangle(Triangle),
}

macro_rules! console_log {
    ($( $arg: expr ),*) => {
        web_sys::console::log_1(&JsValue::from_str(&format!("{}", format_args!($( $arg ),*) )))
    };
}
pub(crate) use console_log;

trait ToJsError<T> {
    fn to_jserr(self) -> Result<T, JsError>;
}
impl<T, E> ToJsError<T> for Result<T, E>
where
    E: std::fmt::Display,
{
    fn to_jserr(self) -> Result<T, JsError> {
        self.map_err(|err| JsError::new(&err.to_string()))
    }
}

#[wasm_bindgen(start)]
pub fn wasm_init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn webgl_init() -> Result<(), JsValue> {
    // only calling for the lazy value to be computed
    #[allow(clippy::let_underscore_lock)]
    let _ = STATE.lock().unwrap();

    Ok(())
}

#[wasm_bindgen]
pub fn add_area(top_line: &str, bot_line: &str, color: &str) -> Result<(), JsError> {
    let rgba = csscolorparser::parse(color).to_jserr()?.rgba_u8();
    let color_rgb = [rgba.0, rgba.1, rgba.2];
    let (tris, lines) = gen_mesh(top_line, bot_line).to_jserr()?;
    STATE
        .lock()
        .unwrap()
        .add_object(tris, lines, color_rgb)
        .to_jserr()?;
    Ok(())
}

#[wasm_bindgen]
pub fn draw() {
    STATE.lock().unwrap().draw_objects();
}
