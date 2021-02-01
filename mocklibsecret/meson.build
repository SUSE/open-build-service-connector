project(
  'libsecret', 'c',
  default_options : [
    'c_std=c11', 'warning_level=3', 'werror=true', 'buildtype=debugoptimized'
  ]
)

glib_dep = dependency('glib-2.0')
secret_dep = dependency('libsecret-1')

cc = meson.get_compiler('c')

# FIXME: clang is broken
if cc.get_id() == 'clang' and (
  get_option('b_sanitize') == 'undefined' or get_option('b_sanitize') == 'address'
)
  add_project_link_arguments('-static-libasan', language : 'c')
endif

mock_libsecret = shared_library(
  'secret',
  ['secret.c'],
  dependencies : [glib_dep, secret_dep]
)

test_script = find_program(meson.current_source_dir() / 'test.js')

# FIXME: this does not work, libasan from gcc is a shared library object which
# path we can't get
if not get_option('b_sanitize').contains('address')
  libasan = ''
elif cc.get_id() == 'clang'
  libasan = run_command(
    cc,
    '-print-file-name=libclang_rt.asan-@0@.so'.format(build_machine.cpu_family()),
  ).stdout().strip()
elif cc.get_id() == 'gcc'
  libasan = cc.find_library('asan')
endif

env = {
        'LD_PRELOAD': '@0@:@1@'.format(libasan, mock_libsecret.full_path()),
        'HOME': meson.current_build_dir()
}

test(
  'integration test',
  test_script,
  is_parallel : false,
  env: env
)
