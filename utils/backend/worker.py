import json
import sys
import importlib

def run_params(step_module, fixed_params, variable_params, step_output=None):
	try:
		if variable_params != None:
			return [replace_numpy_arrays(step_module.run({**fixed_params, **params}, step_output=step_output)) for params in variable_params]
		else:
			return replace_numpy_arrays(step_module.run(fixed_params, step_output=step_output))
	except Exception as e:
		return {'error': f'{e}'}

def replace_numpy_arrays(result):
	return {k: v.tolist() if type(v).__module__ == 'numpy' else v for k, v in result.items()}

def test(step_module):
	try:
		params = step_module.defaults()
		return {
			'input_params': params,
			'dynamics_params': replace_numpy_arrays(step_module.step(step_module.defaults(), False, 0)) if step_module.step else {},
			'result_params': replace_numpy_arrays(step_module.run(step_module.defaults()))
		}
	except Exception as e:
		print(e, file=sys.stderr)
		return {'error': f'{e}'}

def process_job(request):
	step_module = importlib.import_module(request['script'].replace('.py', ''))
	def step_output(step):
		sys.stdout.write(json.dumps({'type': 'dynamics', 'data': replace_numpy_arrays(step)})+'\n')
	if 'test' in request['fixed_params']:
		return test(step_module)
	elif not 'variable_params' in request and hasattr(step_module, 'step'):
		steps = 1 if not request['fixed_params']['target_steps'] else request['fixed_params']['target_steps']
		step = None
		for t in range(0, steps + 1):
			step = step_module.step(request['fixed_params'], step, t)
			if step == False:
				break
			sys.stdout.write(json.dumps({'type': 'dynamics', 'data': replace_numpy_arrays(step)})+'\n')
		return {}
	elif not 'variable_params' in request:
		return run_params(step_module, request['fixed_params'], None, step_output);
	else:
		return run_params(step_module, request['fixed_params'], request['variable_params'], step_output)

def main():
	for line in sys.stdin:
		message = json.loads(line)
		if message['type'] != 'job':
			continue
		result = process_job(message['request'])
		sys.stdout.write(json.dumps({'type': 'result', 'data': result})+'\n')
		sys.stdout.flush()

main()
