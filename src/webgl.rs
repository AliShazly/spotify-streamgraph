use crate::console_log;
use crate::{Line, Triangle};
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{WebGl2RenderingContext as Gl, WebGlProgram, WebGlShader, WebGlVertexArrayObject};

// TODO:
//  applyTransform()

pub type Color = [u8; 3];

pub struct RenderableObject {
    vao: WebGlVertexArrayObject,
    color: Color,
    draw_mode: u32,
    length: usize,
}

pub struct WebglState {
    context: Gl,
    program: WebGlProgram,
    objects: Vec<RenderableObject>,
}

impl WebglState {
    pub fn init(webgl_canvas_id: &str) -> Result<Self, String> {
        let gl = get_webgl_context(webgl_canvas_id).map_err(|e| {
            e.as_string()
                .unwrap_or_else(|| "Error retrieving webgl context".into())
        })?;
        gl.enable(Gl::SAMPLE_COVERAGE);

        let vert_shader = compile_shader(
            &gl,
            Gl::VERTEX_SHADER,
            r##"#version 300 es
 
        in vec2 position;

        uniform vec2 u_resolution;

        // out vec3 randColor;
        // float rand(vec2 co) {
        //     return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
        // }

        void main() {
            vec2 clipSpace = (((position / u_resolution) * 2.0) - 1.0) * vec2(1.0, -1.0);

            gl_Position = vec4(clipSpace, 0.0, 1.0);
            // randColor = vec3(rand(position.xx),rand(position.yx),rand(position.xy));
        }
        "##,
        )?;

        let frag_shader = compile_shader(
            &gl,
            Gl::FRAGMENT_SHADER,
            r##"#version 300 es
        
        precision highp float;

        uniform vec3 u_objColor;
        out vec4 outColor;

        // in vec3 randColor;
        
        void main() {
            outColor = vec4(u_objColor, 1.0);
            // outColor = vec4(randColor, 1.0);
        }
        "##,
        )?;

        let program = link_program(&gl, &vert_shader, &frag_shader)?;
        gl.use_program(Some(&program));

        Ok(Self {
            context: gl,
            program,
            objects: Vec::new(),
        })
    }

    pub fn add_object(
        &mut self,
        triangles: Vec<Triangle>,
        lines: Vec<Line>,
        color: Color,
    ) -> Result<(), String> {
        let gl = &self.context;

        for (pts, draw_mode) in [
            (triangles.concat(), Gl::TRIANGLES),
            (lines.concat(), Gl::LINES),
        ]
        .into_iter()
        .filter(|(arr, _)| !arr.is_empty())
        {
            let buffer = gl.create_buffer().ok_or("Failed to create buffer")?;
            gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&buffer));

            let vao = self
                .context
                .create_vertex_array()
                .ok_or("Could not create vertex array object")?;
            gl.bind_vertex_array(Some(&vao));

            let position_attr_loc = gl.get_attrib_location(&self.program, "position");

            gl.vertex_attrib_pointer_with_i32(position_attr_loc as u32, 2, Gl::FLOAT, false, 0, 0);

            gl.enable_vertex_attrib_array(position_attr_loc as u32);

            let flat_verts: Vec<f32> = pts
                .into_iter()
                .flat_map(|pt| [pt.x as f32, pt.y as f32])
                .collect();

            // unsafe to allocate memory until Float32Array::view() is dropped
            unsafe {
                let positions_array_buf_view = js_sys::Float32Array::view(&flat_verts);

                gl.buffer_data_with_array_buffer_view(
                    Gl::ARRAY_BUFFER,
                    &positions_array_buf_view,
                    Gl::STATIC_DRAW,
                );
            }

            self.objects.push(RenderableObject {
                vao,
                color,
                draw_mode,
                length: flat_verts.len() / 2,
            });
        }

        Ok(())
    }

    // https://www.khronos.org/registry/OpenGL-Refpages/gl4/html/glLineWidth.xhtml
    //     "Line antialiasing is initially disabled."
    pub fn draw_objects(&self) {
        let gl = &self.context;

        gl.clear_color(0.0, 0.0, 0.0, 1.0);
        gl.clear(Gl::COLOR_BUFFER_BIT | Gl::DEPTH_BUFFER_BIT);
        let u_color = gl.get_uniform_location(&self.program, "u_objColor");
        let u_resolution = gl.get_uniform_location(&self.program, "u_resolution");
        gl.uniform2f(
            u_resolution.as_ref(),
            gl.drawing_buffer_width() as f32,
            gl.drawing_buffer_height() as f32,
        );

        for obj in &self.objects {
            let color = obj.color.map(|c| c as f32 / u8::MAX as f32);
            gl.bind_vertex_array(Some(&obj.vao));
            gl.uniform3f(u_color.as_ref(), color[0], color[1], color[2]);
            gl.draw_arrays(obj.draw_mode, 0, obj.length as i32);
        }
    }
}

fn get_webgl_context(canvas_id: &str) -> Result<Gl, JsValue> {
    let document = web_sys::window().unwrap().document().unwrap();
    let canvas = document.get_element_by_id(canvas_id).unwrap();
    let canvas: web_sys::HtmlCanvasElement = canvas.dyn_into::<web_sys::HtmlCanvasElement>()?;
    Ok(canvas.get_context("webgl2")?.unwrap().dyn_into::<Gl>()?)
}

fn compile_shader(context: &Gl, shader_type: u32, source: &str) -> Result<WebGlShader, String> {
    let shader = context
        .create_shader(shader_type)
        .ok_or_else(|| String::from("Unable to create shader object"))?;
    context.shader_source(&shader, source);
    context.compile_shader(&shader);

    if context
        .get_shader_parameter(&shader, Gl::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(shader)
    } else {
        Err(context
            .get_shader_info_log(&shader)
            .unwrap_or_else(|| String::from("Unknown error creating shader")))
    }
}

fn link_program(
    context: &Gl,
    vert_shader: &WebGlShader,
    frag_shader: &WebGlShader,
) -> Result<WebGlProgram, String> {
    let program = context
        .create_program()
        .ok_or_else(|| String::from("Unable to create shader object"))?;

    context.attach_shader(&program, vert_shader);
    context.attach_shader(&program, frag_shader);
    context.link_program(&program);

    if context
        .get_program_parameter(&program, Gl::LINK_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(program)
    } else {
        Err(context
            .get_program_info_log(&program)
            .unwrap_or_else(|| String::from("Unknown error creating program object")))
    }
}
