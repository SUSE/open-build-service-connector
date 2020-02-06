#!/usr/bin/python3

import os
import subprocess
from itertools import product


if __name__ == "__main__":
    for pw, clear_retval, store_retval in product(
        ["aPassword", "another", None], ["1", "0"], ["1", "0"]
    ):
        env = os.environ.copy()
        if pw is not None:
            env["MOCK_SECRET_PASSWORD_LOOKUP"] = pw
        env["MOCK_SECRET_PASSWORD_CLEAR_RETVAL"] = clear_retval
        env["MOCK_SECRET_PASSWORD_STORE_RETVAL"] = store_retval
        env["LD_PRELOAD"] = "./build/libsecret.so"
        retcode = subprocess.call("./test.js", env=env)
        if retcode != 0:
            raise ValueError(
                f"Test with clear_retval={clear_retval} and "
                f"store_retval={store_retval} failed with return code "
                f"{retcode}"
            )
