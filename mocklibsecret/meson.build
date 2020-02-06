project('libsecret', 'c', default_options : ['c_std=c11'])

glib_dep = dependency('glib-2.0')
secret_dep = dependency('libsecret-1')

mock_libsecret = shared_library(
  'secret',
  ['secret.c'],
  dependencies : [glib_dep, secret_dep],
  install : true
)
