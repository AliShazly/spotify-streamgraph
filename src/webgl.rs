use crate::{Line, Triangle};
use cgmatrix as mat4;
use wasm_bindgen::{JsCast, JsError, JsValue};
use web_sys::{
    HtmlCanvasElement, WebGl2RenderingContext as Gl, WebGlFramebuffer, WebGlProgram, WebGlShader,
    WebGlVertexArrayObject,
};

// TODO:
//  resizeFb()

type Color = [u8; 3];

struct RenderableObject {
    vao: WebGlVertexArrayObject,
    color: Color,
    draw_mode: u32,
    length: usize,
}

pub struct WebglState {
    context: Gl,
    program: WebGlProgram,
    frame_buffer: WebGlFramebuffer,
    objects: Vec<RenderableObject>,
    transform_matrix: mat4::Matrix44,
    pub fb_width: i32,
    pub fb_height: i32,
}

impl WebglState {
    pub fn init(webgl_canvas_id: &str) -> Result<Self, String> {
        let gl = get_webgl_context(webgl_canvas_id).map_err(|e| {
            e.as_string()
                .unwrap_or_else(|| "Error retrieving webgl context".into())
        })?;

        let vert_shader = compile_shader(
            &gl,
            Gl::VERTEX_SHADER,
            r##"#version 300 es
 
        in vec2 a_position;

        uniform mat4 u_matrix;

        // out vec3 randColor;
        // float rand(vec2 co) {
        //     return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
        // }

        void main() {
            gl_Position = vec4(u_matrix * vec4(a_position, 0.0, 1.0));
            // randColor = vec3(rand(a_position.xx),rand(a_position.yx),rand(a_position.xy));
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

        let (fb_width, fb_height) = (gl.drawing_buffer_width(), gl.drawing_buffer_height());

        let render_buffer = gl
            .create_renderbuffer()
            .ok_or_else(|| String::from("Unable to create renderbuffer"))?;
        let frame_buffer = gl
            .create_framebuffer()
            .ok_or_else(|| String::from("Unable to create framebuffer"))?;

        let max_samples = gl
            .get_parameter(Gl::MAX_SAMPLES)
            .unwrap_or_else(|_| 4.into())
            .as_f64()
            .unwrap_or(4.) as i32;

        gl.bind_renderbuffer(Gl::RENDERBUFFER, Some(&render_buffer));
        gl.renderbuffer_storage_multisample(
            Gl::RENDERBUFFER,
            max_samples,
            Gl::RGBA8,
            fb_width,
            fb_height,
        );

        gl.bind_framebuffer(Gl::FRAMEBUFFER, Some(&frame_buffer));
        gl.framebuffer_renderbuffer(
            Gl::FRAMEBUFFER,
            Gl::COLOR_ATTACHMENT0,
            Gl::RENDERBUFFER,
            Some(&render_buffer),
        );

        if gl.check_framebuffer_status(Gl::FRAMEBUFFER) != Gl::FRAMEBUFFER_COMPLETE {
            return Err("Incomplete framebuffer".into());
        }

        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.bind_renderbuffer(Gl::RENDERBUFFER, None);

        Ok(Self {
            context: gl,
            program,
            frame_buffer,
            objects: Vec::new(),
            transform_matrix: proj_mat(fb_width as f32, fb_height as f32),
            fb_width,
            fb_height,
        })
    }

    pub fn add_object(
        &mut self,
        triangles: &[Triangle],
        lines: &[Line],
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

            let position_attr_loc = gl.get_attrib_location(&self.program, "a_position");

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

    pub fn draw_objects(&self, draw_lines: bool) {
        let gl = &self.context;

        gl.bind_framebuffer(Gl::DRAW_FRAMEBUFFER, Some(&self.frame_buffer));
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        gl.clear(Gl::COLOR_BUFFER_BIT);
        let u_obj_color = gl.get_uniform_location(&self.program, "u_objColor");
        let u_matrix = gl.get_uniform_location(&self.program, "u_matrix");
        gl.uniform_matrix4fv_with_f32_array(u_matrix.as_ref(), false, &self.transform_matrix);

        for obj in self.objects.iter() {
            if !draw_lines && obj.draw_mode != Gl::TRIANGLES {
                continue;
            }

            let color = obj.color.map(|c| c as f32 / u8::MAX as f32);
            gl.bind_vertex_array(Some(&obj.vao));
            gl.uniform3f(u_obj_color.as_ref(), color[0], color[1], color[2]);
            gl.draw_arrays(obj.draw_mode, 0, obj.length as i32);
        }
        gl.bind_framebuffer(Gl::DRAW_FRAMEBUFFER, None);
        gl.bind_framebuffer(Gl::READ_FRAMEBUFFER, Some(&self.frame_buffer));
        gl.blit_framebuffer(
            0,
            0,
            self.fb_width,
            self.fb_height,
            0,
            0,
            self.fb_width,
            self.fb_height,
            Gl::COLOR_BUFFER_BIT,
            Gl::LINEAR,
        );
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
    }

    pub fn set_transform(&mut self, x: f32, y: f32, scale: f32) {
        let nx = 2. * x / self.fb_width as f32 - 1.;
        let ny = -2. * y / self.fb_height as f32 + 1.;
        #[rustfmt::skip]
        let transformation: mat4::Matrix44 = [
            scale,  0.,     0.,     0.,
            0.,     scale,  0.,     0.,
            0.,     0.,     1.,     0.,
            nx,     ny,     0.,     1.,
        ];
        let origin = mat4::matmul(
            proj_mat(self.fb_width as f32, self.fb_height as f32),
            mat4::translate(1., -1., 0.),
        );
        self.transform_matrix = mat4::matmul(origin, transformation);
    }

    pub fn read_pixels(&self, x: i32, y: i32, w: i32, h: i32) -> Result<Vec<[u8; 4]>, String> {
        let gl = &self.context;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);

        let n_pixels = (w * h) as usize;
        let mut subpixels = vec![0u8; n_pixels * 4];
        gl.read_pixels_with_opt_u8_array(
            x,
            y,
            w,
            h,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            Some(subpixels.as_mut_slice()),
        )
        .map_err(|jsv| {
            jsv.as_string()
                .unwrap_or_else(|| String::from("Error reading pixels"))
        })?;

        Ok(subpixels
            .chunks_exact(4)
            .map(|px| px.try_into().unwrap())
            .collect())
    }
}

fn get_webgl_context(canvas_id: &str) -> Result<Gl, JsValue> {
    let document = web_sys::window().unwrap().document().unwrap();
    let canvas = document
        .get_element_by_id(canvas_id)
        .ok_or_else(|| JsError::new("Invalid canvas id"))?
        .dyn_into::<HtmlCanvasElement>()?;

    let ctx_options = js_sys::Object::new();
    js_sys::Reflect::set(&ctx_options, &"antialias".into(), &false.into())?;
    js_sys::Reflect::set(&ctx_options, &"preserveDrawingBuffer".into(), &true.into())?;

    Ok(canvas
        .get_context_with_context_options("webgl2", &ctx_options)?
        .unwrap()
        .dyn_into::<Gl>()?)
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

fn proj_mat(w: f32, h: f32) -> mat4::Matrix44 {
    mat4::orthogonal_matrix(0., w, 0., h, 1., -1.)
}
