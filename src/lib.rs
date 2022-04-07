#![feature(vec_into_raw_parts)]
#![allow(clippy::unused_unit)]

mod triangulate;
mod webgl;

use std::fmt::Display;
use triangulate::gen_mesh;
use wasm_bindgen::prelude::*;
use webgl::WebglState;

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

macro_rules! console_log {
    ($( $arg: expr ),*) => {
        web_sys::console::log_1(&JsValue::from_str(&format!("{}", format_args!($( $arg ),*) )))
    };
}
pub(crate) use console_log;

trait ToJsError<T> {
    fn to_jserr(self) -> Result<T, JsError>;
}
impl<T, E: Display> ToJsError<T> for Result<T, E> {
    fn to_jserr(self) -> Result<T, JsError> {
        self.map_err(|err| JsError::new(&err.to_string()))
    }
}

#[wasm_bindgen]
pub struct TriangulatedArea {
    triangles: Vec<Triangle>,
    lines: Vec<Line>,
}

#[wasm_bindgen]
impl TriangulatedArea {
    #[wasm_bindgen(constructor)]
    pub fn new(top_line: &str, bot_line: &str) -> Result<TriangulatedArea, JsError> {
        let (triangles, lines) = gen_mesh(top_line, bot_line).to_jserr()?;
        Ok(TriangulatedArea { triangles, lines })
    }
}

#[wasm_bindgen]
pub struct WebglCtx {
    internal: WebglState,
}

#[wasm_bindgen]
impl WebglCtx {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas_id: &str) -> Result<WebglCtx, JsError> {
        let internal = WebglState::init(canvas_id).to_jserr()?;
        Ok(WebglCtx { internal })
    }

    pub fn add_area(&mut self, area: &TriangulatedArea, color: &str) -> Result<(), JsError> {
        let rgba = csscolorparser::parse(color).to_jserr()?.rgba_u8();
        let color_rgb = [rgba.0, rgba.1, rgba.2];
        let TriangulatedArea { triangles, lines } = area;
        self.internal
            .add_object(triangles, lines, color_rgb)
            .to_jserr()?;
        Ok(())
    }

    pub fn draw(&self) -> Result<(), JsError> {
        self.internal.draw_objects(false);
        Ok(())
    }

    pub fn set_transform(&mut self, x: f32, y: f32, scale: f32) -> Result<(), JsError> {
        self.internal.set_transform(x, y, scale);
        Ok(())
    }

    pub fn get_pixel(&self, x: i32, y: i32) -> Result<u32, JsError> {
        let pixels = self
            .internal
            .read_pixels(x, (self.internal.fb_height - 1) - y, 1, 1)
            .to_jserr()?;
        Ok(pack_rgba(pixels[0]))
    }
}

#[wasm_bindgen(start)]
pub fn wasm_init() {
    console_error_panic_hook::set_once();
}

fn pack_rgba(rgba: [u8; 4]) -> u32 {
    let rgba = rgba.map(|subpx| subpx as u32);
    rgba[0] << 24 | rgba[1] << 16 | rgba[2] << 8 | rgba[3]
}
